package main

import (
	"archive/zip"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/pgaskin/kepubify/v4/kepub"
)

const (
	maxUploadSize  int64         = 256 << 20 // 256MB
	requestTimeout time.Duration = 8 * time.Minute

	formFieldFile       = "file"
	formFieldFormatFrom = "format_from"
	formFieldFormatTo   = "format_to"
	formFieldMetadata   = "metadata"
	formFieldCover      = "cover"

	formatEPUB  = "epub"
	formatKEPUB = "kepub"
	formatAZW3  = "azw3"
	formatMOBI  = "mobi"
)

var supportedFormats = map[string]struct{}{
	formatEPUB:  {},
	formatKEPUB: {},
	formatAZW3:  {},
	formatMOBI:  {},
}

type metadataPayload struct {
	Title     string   `json:"title"`
	Authors   []string `json:"authors"`
	Language  string   `json:"language"`
	Publisher string   `json:"publisher"`
}

type requestPayload struct {
	formatFrom string
	formatTo   string
	metadata   metadataPayload
	inputPath  string
	coverPath  string
	cleanup    func()
}

type errorResponse struct {
	Error string `json:"error"`
}

type responseWriteError struct {
	cause           error
	responseStarted bool
}

func (e *responseWriteError) Error() string {
	return e.cause.Error()
}

func (e *responseWriteError) Unwrap() error {
	return e.cause
}

func main() {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", handleHealth)
	mux.HandleFunc("POST /process", handleProcess)
	mux.HandleFunc("POST /convert", handleConvert)

	server := &http.Server{
		Addr:              "0.0.0.0:8080",
		Handler:           mux,
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       5 * time.Minute,
		IdleTimeout:       60 * time.Second,
		WriteTimeout:      0,
		MaxHeaderBytes:    1 << 20,
	}

	log.Println("converter listening on 0.0.0.0:8080")
	log.Fatal(server.ListenAndServe())
}

func handleHealth(w http.ResponseWriter, _ *http.Request) {
	w.WriteHeader(http.StatusOK)
}

func handleProcess(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, maxUploadSize)
	ctx, cancel := context.WithTimeout(r.Context(), requestTimeout)
	defer cancel()

	payload, err := parseRequestPayload(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error(), err)
		return
	}
	defer payload.cleanup()

	payload.formatFrom = normalizeFormat(payload.formatFrom)
	payload.formatTo = normalizeFormat(payload.formatTo)

	if payload.formatFrom == "" {
		writeError(w, http.StatusBadRequest, "format_from is required", nil)
		return
	}

	if !isSupportedFormat(payload.formatFrom) {
		writeError(w, http.StatusUnprocessableEntity, fmt.Sprintf("unsupported source format: %q", payload.formatFrom), nil)
		return
	}

	if payload.formatTo != "" && payload.formatTo != payload.formatFrom {
		writeError(w, http.StatusUnprocessableEntity, "/process does not perform format conversion; use /convert instead", nil)
		return
	}

	if shouldApplyMetadata(payload.metadata, payload.coverPath) {
		if err := applyMetadataWithCalibre(
			ctx,
			payload.inputPath,
			payload.formatFrom,
			payload.metadata,
			payload.coverPath,
		); err != nil {
			if isContextTimeout(err) {
				writeError(w, http.StatusGatewayTimeout, "metadata processing timed out", err)
				return
			}
			writeError(w, http.StatusUnprocessableEntity, "metadata processing failed", err)
			return
		}
	}

	if err := writeFileResponseFromPath(ctx, w, payload.formatFrom, payload.inputPath); err != nil {
		writeErrorIfPossible(w, http.StatusInternalServerError, "failed to write response", err)
	}
}

func handleConvert(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, maxUploadSize)
	ctx, cancel := context.WithTimeout(r.Context(), requestTimeout)
	defer cancel()

	payload, err := parseRequestPayload(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error(), err)
		return
	}
	defer payload.cleanup()

	formatFrom := normalizeFormat(payload.formatFrom)
	formatTo := normalizeFormat(payload.formatTo)
	if formatFrom == "" || formatTo == "" {
		writeError(w, http.StatusBadRequest, "format_from and format_to are required", nil)
		return
	}

	if !isSupportedFormat(formatFrom) {
		writeError(w, http.StatusUnprocessableEntity, fmt.Sprintf("unsupported source format: %q", formatFrom), nil)
		return
	}

	if !isSupportedFormat(formatTo) {
		writeError(w, http.StatusUnprocessableEntity, fmt.Sprintf("unsupported target format: %q", formatTo), nil)
		return
	}

	switch formatTo {
	case formatFrom:
		if err := writeFileResponseFromPath(ctx, w, formatFrom, payload.inputPath); err != nil {
			writeErrorIfPossible(w, http.StatusInternalServerError, "failed to write response", err)
		}
	case formatKEPUB:
		if formatFrom != formatEPUB {
			writeError(w, http.StatusUnprocessableEntity, fmt.Sprintf("kepub conversion requires epub source, got %q", formatFrom), nil)
			return
		}
		if err := convertToKepub(ctx, w, payload.inputPath); err != nil {
			if isContextTimeout(err) {
				writeErrorIfPossible(w, http.StatusGatewayTimeout, "conversion timed out", err)
				return
			}
			writeErrorIfPossible(w, http.StatusInternalServerError, "kepub conversion failed", err)
		}
	case formatAZW3, formatMOBI:
		if err := convertWithCalibre(ctx, w, payload.inputPath, formatFrom, formatTo); err != nil {
			if isContextTimeout(err) {
				writeErrorIfPossible(w, http.StatusGatewayTimeout, "conversion timed out", err)
				return
			}
			writeErrorIfPossible(w, http.StatusUnprocessableEntity, "ebook conversion failed", err)
		}

	// Future formats via ebook-convert (requires Calibre in Dockerfile):
	// case "mobi", "azw3":
	//   convertWithCalibre(w, data, formatFrom, formatTo)

	default:
		writeError(w, http.StatusUnprocessableEntity, fmt.Sprintf("unsupported target format: %q", formatTo), nil)
	}
}

func parseRequestPayload(r *http.Request) (requestPayload, error) {
	cleanupFns := make([]func(), 0, 2)
	cleanup := func() {
		for i := len(cleanupFns) - 1; i >= 0; i-- {
			cleanupFns[i]()
		}
	}

	// Stream multipart parts directly to temp files instead of buffering via
	// ParseMultipartForm. This avoids holding ~32 MB in heap and eliminates the
	// intermediate multipart temp file (~235 MB saved on disk for large uploads).
	mr, err := r.MultipartReader()
	if err != nil {
		return requestPayload{}, fmt.Errorf("create multipart reader: %w", err)
	}

	var payload requestPayload

	for {
		part, err := mr.NextPart()
		if err == io.EOF {
			break
		}
		if err != nil {
			cleanup()
			return requestPayload{}, fmt.Errorf("read multipart part: %w", err)
		}

		switch part.FormName() {
		case formFieldFile:
			inputFile, err := os.CreateTemp("", "upload-*")
			if err != nil {
				_ = part.Close()
				cleanup()
				return requestPayload{}, fmt.Errorf("create temp input: %w", err)
			}
			cleanupFns = append(cleanupFns, func() {
				if err := os.Remove(inputFile.Name()); err != nil && !errors.Is(err, os.ErrNotExist) {
					log.Printf("cleanup input temp file failed: %v", err)
				}
			})

			n, err := io.Copy(inputFile, part)
			_ = part.Close()
			if err != nil {
				_ = inputFile.Close()
				cleanup()
				return requestPayload{}, fmt.Errorf("write temp input: %w", err)
			}
			if err := inputFile.Close(); err != nil {
				cleanup()
				return requestPayload{}, fmt.Errorf("close temp input: %w", err)
			}
			if n > maxUploadSize {
				cleanup()
				return requestPayload{}, fmt.Errorf("uploaded file exceeds maximum size")
			}
			payload.inputPath = inputFile.Name()

		case formFieldCover:
			coverPattern := "cover-*"
			if fn := part.FileName(); fn != "" {
				ext := strings.TrimSpace(strings.ToLower(filepath.Ext(fn)))
				if ext == "" {
					ext = coverExtForContentType(part.Header.Get("Content-Type"))
				}
				if ext != "" {
					coverPattern = fmt.Sprintf("cover-*%s", ext)
				}
			}

			coverFile, err := os.CreateTemp("", coverPattern)
			if err != nil {
				_ = part.Close()
				cleanup()
				return requestPayload{}, fmt.Errorf("create temp cover: %w", err)
			}
			cleanupFns = append(cleanupFns, func() {
				if err := os.Remove(coverFile.Name()); err != nil && !errors.Is(err, os.ErrNotExist) {
					log.Printf("cleanup cover temp file failed: %v", err)
				}
			})

			n, err := io.Copy(coverFile, part)
			_ = part.Close()
			if err != nil {
				_ = coverFile.Close()
				cleanup()
				return requestPayload{}, fmt.Errorf("write temp cover: %w", err)
			}
			if err := coverFile.Close(); err != nil {
				cleanup()
				return requestPayload{}, fmt.Errorf("close temp cover: %w", err)
			}
			if n > maxUploadSize {
				cleanup()
				return requestPayload{}, fmt.Errorf("uploaded cover exceeds maximum size")
			}
			payload.coverPath = coverFile.Name()

		case formFieldFormatFrom:
			data, err := io.ReadAll(io.LimitReader(part, 64))
			_ = part.Close()
			if err != nil {
				cleanup()
				return requestPayload{}, fmt.Errorf("read format_from: %w", err)
			}
			payload.formatFrom = string(data)

		case formFieldFormatTo:
			data, err := io.ReadAll(io.LimitReader(part, 64))
			_ = part.Close()
			if err != nil {
				cleanup()
				return requestPayload{}, fmt.Errorf("read format_to: %w", err)
			}
			payload.formatTo = string(data)

		case formFieldMetadata:
			data, err := io.ReadAll(io.LimitReader(part, 1<<20))
			_ = part.Close()
			if err != nil {
				cleanup()
				return requestPayload{}, fmt.Errorf("read metadata: %w", err)
			}
			if len(data) > 0 {
				if err := json.Unmarshal(data, &payload.metadata); err != nil {
					cleanup()
					return requestPayload{}, fmt.Errorf("invalid metadata payload: %w", err)
				}
			}

		default:
			_, _ = io.Copy(io.Discard, part)
			_ = part.Close()
		}
	}

	if payload.inputPath == "" {
		cleanup()
		return requestPayload{}, fmt.Errorf("file field is required")
	}

	// Rename the temp file with the correct extension so calibre tools
	// (ebook-convert / ebook-meta / ebook-polish) can recognise the format.
	normalizedFrom := normalizeFormat(payload.formatFrom)
	if isSupportedFormat(normalizedFrom) {
		newPath := payload.inputPath + "." + normalizedFrom
		if err := os.Rename(payload.inputPath, newPath); err == nil {
			payload.inputPath = newPath
			cleanupFns = append(cleanupFns, func() {
				if err := os.Remove(newPath); err != nil && !errors.Is(err, os.ErrNotExist) {
					log.Printf("cleanup renamed input file failed: %v", err)
				}
			})
		}
	}

	payload.cleanup = cleanup
	return payload, nil
}

func normalizeFormat(value string) string {
	return strings.ToLower(strings.TrimSpace(value))
}

func coverExtForContentType(contentType string) string {
	normalized := strings.TrimSpace(strings.ToLower(contentType))
	if idx := strings.Index(normalized, ";"); idx >= 0 {
		normalized = strings.TrimSpace(normalized[:idx])
	}

	switch normalized {
	case "image/jpeg", "image/jpg", "image/pjpeg":
		return ".jpg"
	case "image/png", "image/x-png":
		return ".png"
	case "image/webp":
		return ".webp"
	case "image/gif":
		return ".gif"
	default:
		return ""
	}
}

func isSupportedFormat(format string) bool {
	_, ok := supportedFormats[format]
	return ok
}

func shouldApplyMetadata(metadata metadataPayload, coverPath string) bool {
	return metadata.Title != "" ||
		len(metadata.Authors) > 0 ||
		metadata.Language != "" ||
		metadata.Publisher != "" ||
		strings.TrimSpace(coverPath) != ""
}

func applyMetadataWithCalibre(
	ctx context.Context,
	inputPath string,
	formatFrom string,
	metadata metadataPayload,
	coverPath string,
) error {
	args := []string{inputPath}
	normalizedFormat := normalizeFormat(formatFrom)
	trimmedCover := strings.TrimSpace(coverPath)

	if title := strings.TrimSpace(metadata.Title); title != "" {
		args = append(args, "--title", title)
	}

	if len(metadata.Authors) > 0 {
		authors := make([]string, 0, len(metadata.Authors))
		for _, author := range metadata.Authors {
			trimmed := strings.TrimSpace(author)
			if trimmed != "" {
				authors = append(authors, trimmed)
			}
		}
		if len(authors) > 0 {
			args = append(args, "--authors", strings.Join(authors, " & "))
		}
	}

	if language := normalizeFormat(metadata.Language); language != "" {
		args = append(args, "--language", language)
	}

	if publisher := strings.TrimSpace(metadata.Publisher); publisher != "" {
		args = append(args, "--publisher", publisher)
	}

	// Keep non-EPUB formats on ebook-meta --cover.
	if trimmedCover != "" && normalizedFormat != formatEPUB && normalizedFormat != formatKEPUB {
		args = append(args, "--cover", trimmedCover)
	}

	if len(args) > 1 {
		cmd := exec.CommandContext(ctx, "ebook-meta", args...)
		cmd.Stdout = os.Stderr
		cmd.Stderr = os.Stderr
		if err := cmd.Run(); err != nil {
			log.Printf("ebook-meta failed: input=%s err=%v", inputPath, err)
			return err
		}
	}

	if trimmedCover != "" && (normalizedFormat == formatEPUB || normalizedFormat == formatKEPUB) {
		if err := applyCoverWithPolish(ctx, inputPath, trimmedCover); err != nil {
			return err
		}
	}

	return nil
}

func applyCoverWithPolish(ctx context.Context, inputPath string, coverPath string) error {
	outputFile, err := os.CreateTemp("", "polish-cover-*.epub")
	if err != nil {
		return fmt.Errorf("create polish output: %w", err)
	}
	outputPath := outputFile.Name()
	if err := outputFile.Close(); err != nil {
		_ = os.Remove(outputPath)
		return fmt.Errorf("close polish output temp file: %w", err)
	}
	defer func() {
		_ = os.Remove(outputPath)
	}()

	cmd := exec.CommandContext(ctx, "ebook-polish", "--cover", coverPath, inputPath, outputPath)
	cmd.Stdout = os.Stderr
	cmd.Stderr = os.Stderr
	if err := cmd.Run(); err != nil {
		log.Printf("ebook-polish failed: input=%s cover=%s err=%v", inputPath, coverPath, err)
		return err
	}

	if err := os.Rename(outputPath, inputPath); err != nil {
		return fmt.Errorf("replace polished epub: %w", err)
	}

	return nil
}

func writeFileResponseFromPath(ctx context.Context, w http.ResponseWriter, format string, filePath string) error {
	file, err := os.Open(filePath)
	if err != nil {
		return fmt.Errorf("open file response source: %w", err)
	}
	defer file.Close()

	stat, err := file.Stat()
	if err != nil {
		return fmt.Errorf("stat file response source: %w", err)
	}

	w.Header().Set("Content-Type", contentTypeForFormat(format))
	w.Header().Set("Content-Length", fmt.Sprintf("%d", stat.Size()))
	w.WriteHeader(http.StatusOK)

	if _, err := io.Copy(w, newContextReader(ctx, file)); err != nil {
		return &responseWriteError{
			cause:           fmt.Errorf("stream file response: %w", err),
			responseStarted: true,
		}
	}

	return nil
}

func convertToKepub(ctx context.Context, w http.ResponseWriter, inputPath string) error {
	inputFile, err := os.Open(inputPath)
	if err != nil {
		return fmt.Errorf("read input file: %w", err)
	}
	defer inputFile.Close()

	stat, err := inputFile.Stat()
	if err != nil {
		return fmt.Errorf("stat input file: %w", err)
	}

	// Keep memory flat by reading the EPUB ZIP directly from disk via ReaderAt.
	zipReader, err := zip.NewReader(inputFile, stat.Size())
	if err != nil {
		return fmt.Errorf("open epub as zip: %w", err)
	}

	outputFile, err := os.CreateTemp("", "kepub-output-*.kepub")
	if err != nil {
		return fmt.Errorf("create kepub output: %w", err)
	}
	defer func() {
		_ = outputFile.Close()
		_ = os.Remove(outputFile.Name())
	}()

	conv := kepub.NewConverter()
	if err := conv.Convert(ctx, outputFile, zipReader); err != nil {
		return fmt.Errorf("kepub conversion failed: %w", err)
	}

	if err := outputFile.Close(); err != nil {
		return fmt.Errorf("close kepub output: %w", err)
	}

	if err := writeFileResponseFromPath(ctx, w, "kepub", outputFile.Name()); err != nil {
		return err
	}

	return nil
}

func convertWithCalibre(ctx context.Context, w http.ResponseWriter, inputPath string, formatFrom string, formatTo string) error {
	_ = formatFrom

	outputFile := fmt.Sprintf("%s.%s", inputPath, formatTo)
	defer func() {
		_ = os.Remove(outputFile)
	}()

	cmd := exec.CommandContext(ctx, "ebook-convert", inputPath, outputFile)
	cmd.Stdout = os.Stderr
	cmd.Stderr = os.Stderr
	if err := cmd.Run(); err != nil {
		log.Printf("ebook-convert failed: input=%s target=%s err=%v", inputPath, formatTo, err)
		return err
	}

	w.Header().Set("X-Output-Format", formatTo)
	if err := writeFileResponseFromPath(ctx, w, formatTo, outputFile); err != nil {
		return err
	}

	return nil
}

func contentTypeForFormat(format string) string {
	switch format {
	case formatEPUB, formatKEPUB:
		return "application/epub+zip"
	case formatMOBI:
		return "application/x-mobipocket-ebook"
	case formatAZW3:
		return "application/vnd.amazon.mobi8-ebook"
	default:
		return "application/octet-stream"
	}
}

func isContextTimeout(err error) bool {
	return errors.Is(err, context.DeadlineExceeded) || errors.Is(err, context.Canceled)
}

func canWriteErrorResponse(err error) bool {
	var streamErr *responseWriteError
	if errors.As(err, &streamErr) {
		return !streamErr.responseStarted
	}

	return true
}

func writeErrorIfPossible(w http.ResponseWriter, status int, message string, err error) {
	if canWriteErrorResponse(err) {
		writeError(w, status, message, err)
		return
	}

	log.Printf("request failed after response started: status=%d message=%q err=%v", status, message, err)
}

func writeError(w http.ResponseWriter, status int, message string, err error) {
	if err != nil {
		log.Printf("request failed: status=%d message=%q err=%v", status, message, err)
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(errorResponse{Error: message})
}

type contextReader struct {
	ctx context.Context
	r   io.Reader
}

func newContextReader(ctx context.Context, r io.Reader) io.Reader {
	return &contextReader{ctx: ctx, r: r}
}

func (c *contextReader) Read(p []byte) (int, error) {
	select {
	case <-c.ctx.Done():
		return 0, c.ctx.Err()
	default:
		return c.r.Read(p)
	}
}
