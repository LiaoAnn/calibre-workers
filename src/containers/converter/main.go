package main

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"strings"
	"time"

	"github.com/pgaskin/kepubify/v4/kepub"
)

const (
	maxUploadSize      int64         = 256 << 20 // 256MB
	multipartMemoryMax int64         = 32 << 20  // 32MB kept in memory; rest spills to disk
	requestTimeout     time.Duration = 8 * time.Minute
)

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
	cleanup    func()
}

type errorResponse struct {
	Error string `json:"error"`
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
		ReadTimeout:       2 * time.Minute,
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

	if shouldApplyMetadata(payload.metadata) {
		if err := applyMetadataWithCalibre(ctx, payload.inputPath, payload.metadata); err != nil {
			if errors.Is(err, context.DeadlineExceeded) || errors.Is(err, context.Canceled) {
				writeError(w, http.StatusGatewayTimeout, "metadata processing timed out", err)
				return
			}
			writeError(w, http.StatusUnprocessableEntity, "metadata processing failed", err)
			return
		}
	}

	if err := writeFileResponseFromPath(ctx, w, payload.formatFrom, payload.inputPath); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to write response", err)
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
			writeError(w, http.StatusInternalServerError, "failed to write response", err)
		}
	case "kepub":
		if formatFrom != "epub" {
			writeError(w, http.StatusUnprocessableEntity, fmt.Sprintf("kepub conversion requires epub source, got %q", formatFrom), nil)
			return
		}
		if err := convertToKepub(ctx, w, payload.inputPath); err != nil {
			if errors.Is(err, context.DeadlineExceeded) || errors.Is(err, context.Canceled) {
				writeError(w, http.StatusGatewayTimeout, "conversion timed out", err)
				return
			}
			writeError(w, http.StatusInternalServerError, "kepub conversion failed", err)
		}
	case "azw3", "mobi", "txt":
		if err := convertWithCalibre(ctx, w, payload.inputPath, formatFrom, formatTo); err != nil {
			if errors.Is(err, context.DeadlineExceeded) || errors.Is(err, context.Canceled) {
				writeError(w, http.StatusGatewayTimeout, "conversion timed out", err)
				return
			}
			writeError(w, http.StatusUnprocessableEntity, "ebook conversion failed", err)
		}

	// Future formats via ebook-convert (requires Calibre in Dockerfile):
	// case "mobi", "azw3":
	//   convertWithCalibre(w, data, formatFrom, formatTo)

	default:
		writeError(w, http.StatusUnprocessableEntity, fmt.Sprintf("unsupported target format: %q", formatTo), nil)
	}
}

func parseRequestPayload(r *http.Request) (requestPayload, error) {
	if err := r.ParseMultipartForm(multipartMemoryMax); err != nil {
		return requestPayload{}, fmt.Errorf("parse form: %w", err)
	}

	formatFrom := normalizeFormat(r.FormValue("format_from"))
	formatTo := normalizeFormat(r.FormValue("format_to"))

	file, header, err := r.FormFile("file")
	if err != nil {
		return requestPayload{}, fmt.Errorf("read file: %w", err)
	}
	defer file.Close()

	tempPattern := "upload-*"
	if isSupportedFormat(formatFrom) {
		tempPattern = fmt.Sprintf("upload-*.%s", formatFrom)
	}

	inputFile, err := os.CreateTemp("", tempPattern)
	if err != nil {
		return requestPayload{}, fmt.Errorf("create temp input: %w", err)
	}

	cleanup := func() {
		_ = os.Remove(inputFile.Name())
	}

	if _, err := io.Copy(inputFile, file); err != nil {
		_ = inputFile.Close()
		cleanup()
		return requestPayload{}, fmt.Errorf("write temp input: %w", err)
	}

	if err := inputFile.Close(); err != nil {
		cleanup()
		return requestPayload{}, fmt.Errorf("close temp input: %w", err)
	}

	payload := requestPayload{
		formatFrom: formatFrom,
		formatTo:   formatTo,
		inputPath:  inputFile.Name(),
		cleanup:    cleanup,
	}

	if header != nil && header.Size > maxUploadSize {
		cleanup()
		return requestPayload{}, fmt.Errorf("uploaded file exceeds maximum size")
	}

	if rawMetadata := r.FormValue("metadata"); rawMetadata != "" {
		if err := json.Unmarshal([]byte(rawMetadata), &payload.metadata); err != nil {
			cleanup()
			return requestPayload{}, fmt.Errorf("invalid metadata payload: %w", err)
		}
	}

	return payload, nil
}

func normalizeFormat(value string) string {
	return strings.ToLower(strings.TrimSpace(value))
}

func isSupportedFormat(format string) bool {
	switch format {
	case "epub", "kepub", "azw3", "mobi", "txt":
		return true
	default:
		return false
	}
}

func shouldApplyMetadata(metadata metadataPayload) bool {
	return metadata.Title != "" ||
		len(metadata.Authors) > 0 ||
		metadata.Language != "" ||
		metadata.Publisher != ""
}

func applyMetadataWithCalibre(ctx context.Context, inputPath string, metadata metadataPayload) error {
	args := []string{inputPath}

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

	if len(args) == 1 {
		return nil
	}

	cmd := exec.CommandContext(ctx, "ebook-meta", args...)
	output, err := cmd.CombinedOutput()
	if err != nil {
		log.Printf("ebook-meta failed: input=%s err=%v output=%s", inputPath, err, string(output))
		return err
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
		return fmt.Errorf("stream file response: %w", err)
	}

	return nil
}

func convertToKepub(ctx context.Context, w http.ResponseWriter, inputPath string) error {
	data, err := os.ReadFile(inputPath)
	if err != nil {
		return fmt.Errorf("read input file: %w", err)
	}

	// EPUB is a ZIP archive; zip.Reader implements fs.FS (Go 1.16+)
	zipReader, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
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
	output, err := cmd.CombinedOutput()
	if err != nil {
		log.Printf("ebook-convert failed: input=%s target=%s err=%v output=%s", inputPath, formatTo, err, string(output))
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
	case "epub", "kepub":
		return "application/epub+zip"
	case "mobi":
		return "application/x-mobipocket-ebook"
	case "azw3":
		return "application/vnd.amazon.mobi8-ebook"
	case "txt":
		return "text/plain; charset=utf-8"
	default:
		return "application/octet-stream"
	}
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
