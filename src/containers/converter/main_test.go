package main

import (
	"bytes"
	"context"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/textproto"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

func TestCoverExtForContentType(t *testing.T) {
	tests := []struct {
		name        string
		contentType string
		expectedExt string
	}{
		{
			name:        "jpeg",
			contentType: "image/jpeg",
			expectedExt: ".jpg",
		},
		{
			name:        "jpeg alias",
			contentType: "image/jpg",
			expectedExt: ".jpg",
		},
		{
			name:        "progressive jpeg alias",
			contentType: "image/pjpeg",
			expectedExt: ".jpg",
		},
		{
			name:        "png with charset",
			contentType: "image/png; charset=binary",
			expectedExt: ".png",
		},
		{
			name:        "png alias",
			contentType: "image/x-png",
			expectedExt: ".png",
		},
		{
			name:        "webp uppercase",
			contentType: "IMAGE/WEBP",
			expectedExt: ".webp",
		},
		{
			name:        "gif",
			contentType: "image/gif",
			expectedExt: ".gif",
		},
		{
			name:        "unsupported",
			contentType: "application/octet-stream",
			expectedExt: "",
		},
		{
			name:        "empty",
			contentType: "",
			expectedExt: "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := coverExtForContentType(tt.contentType)
			if got != tt.expectedExt {
				t.Fatalf("expected %q, got %q", tt.expectedExt, got)
			}
		})
	}
}

func TestWriteFileResponseFromPath_SetsExactContentLength(t *testing.T) {
	content := []byte("converted-epub")
	filePath := filepath.Join(t.TempDir(), "output.epub")
	if err := os.WriteFile(filePath, content, 0o600); err != nil {
		t.Fatalf("write fixture failed: %v", err)
	}

	recorder := httptest.NewRecorder()
	if err := writeFileResponseFromPath(
		context.Background(),
		recorder,
		formatEPUB,
		filePath,
	); err != nil {
		t.Fatalf("writeFileResponseFromPath failed: %v", err)
	}

	response := recorder.Result()
	defer response.Body.Close()
	if got, want := response.Header.Get("Content-Length"), strconv.Itoa(len(content)); got != want {
		t.Fatalf("expected Content-Length %q, got %q", want, got)
	}
	body, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatalf("read response body failed: %v", err)
	}
	if !bytes.Equal(body, content) {
		t.Fatalf("expected response body %q, got %q", content, body)
	}
}

func TestParseRequestPayload_InfersCoverExtFromContentType(t *testing.T) {
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)

	if err := writer.WriteField(formFieldFormatFrom, formatEPUB); err != nil {
		t.Fatalf("write format_from failed: %v", err)
	}
	if err := writer.WriteField(formFieldFormatTo, formatEPUB); err != nil {
		t.Fatalf("write format_to failed: %v", err)
	}

	filePart, err := writer.CreateFormFile(formFieldFile, "input.epub")
	if err != nil {
		t.Fatalf("create file part failed: %v", err)
	}
	if _, err := filePart.Write([]byte("dummy-epub")); err != nil {
		t.Fatalf("write file part failed: %v", err)
	}

	coverHeader := make(textproto.MIMEHeader)
	coverHeader.Set("Content-Disposition", `form-data; name="cover"; filename="cover"`)
	coverHeader.Set("Content-Type", "image/png")
	coverPart, err := writer.CreatePart(coverHeader)
	if err != nil {
		t.Fatalf("create cover part failed: %v", err)
	}
	if _, err := coverPart.Write([]byte{0x89, 0x50, 0x4E, 0x47}); err != nil {
		t.Fatalf("write cover part failed: %v", err)
	}

	if err := writer.Close(); err != nil {
		t.Fatalf("close multipart writer failed: %v", err)
	}

	req := httptest.NewRequest(http.MethodPost, "/process", &body)
	req.Header.Set("Content-Type", writer.FormDataContentType())

	payload, err := parseRequestPayload(req)
	if err != nil {
		t.Fatalf("parseRequestPayload failed: %v", err)
	}
	defer payload.cleanup()

	if ext := strings.ToLower(filepath.Ext(payload.coverPath)); ext != ".png" {
		t.Fatalf("expected cover temp file extension .png, got %q from %q", ext, payload.coverPath)
	}
}
