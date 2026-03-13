package main

import (
	"archive/zip"
	"bytes"
	"context"
	"fmt"
	"io"
	"log"
	"net/http"

	"github.com/pgaskin/kepubify/v4/kepub"
)

func main() {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", handleHealth)
	mux.HandleFunc("POST /convert", handleConvert)

	log.Println("converter listening on 0.0.0.0:8080")
	log.Fatal(http.ListenAndServe("0.0.0.0:8080", mux))
}

func handleHealth(w http.ResponseWriter, _ *http.Request) {
	w.WriteHeader(http.StatusOK)
}

func handleConvert(w http.ResponseWriter, r *http.Request) {
	// 256 MB max upload
	if err := r.ParseMultipartForm(256 << 20); err != nil {
		http.Error(w, fmt.Sprintf("parse form: %v", err), http.StatusBadRequest)
		return
	}

	formatFrom := r.FormValue("format_from")
	formatTo := r.FormValue("format_to")

	file, _, err := r.FormFile("file")
	if err != nil {
		http.Error(w, fmt.Sprintf("read file: %v", err), http.StatusBadRequest)
		return
	}
	defer file.Close()

	data, err := io.ReadAll(file)
	if err != nil {
		http.Error(w, fmt.Sprintf("read data: %v", err), http.StatusInternalServerError)
		return
	}

	switch formatTo {
	case "kepub":
		if formatFrom != "epub" {
			http.Error(w, fmt.Sprintf("kepub conversion requires epub source, got %q", formatFrom), http.StatusUnprocessableEntity)
			return
		}
		convertToKepub(w, data)

	// Future formats via ebook-convert (requires Calibre in Dockerfile):
	// case "mobi", "azw3":
	//   convertWithCalibre(w, data, formatFrom, formatTo)

	default:
		http.Error(w, fmt.Sprintf("unsupported target format: %q", formatTo), http.StatusUnprocessableEntity)
	}
}

func convertToKepub(w http.ResponseWriter, data []byte) {
	// EPUB is a ZIP archive; zip.Reader implements fs.FS (Go 1.16+)
	zipReader, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		http.Error(w, fmt.Sprintf("open epub as zip: %v", err), http.StatusBadRequest)
		return
	}

	var dst bytes.Buffer
	conv := kepub.NewConverter()
	if err := conv.Convert(context.Background(), &dst, zipReader); err != nil {
		http.Error(w, fmt.Sprintf("kepub conversion failed: %v", err), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/epub+zip")
	w.Header().Set("Content-Length", fmt.Sprintf("%d", dst.Len()))
	w.WriteHeader(http.StatusOK)
	_, _ = io.Copy(w, &dst)
}
