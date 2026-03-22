//go:build integration

package main

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/xml"
	"io"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

type opfPackage struct {
	XMLName  xml.Name `xml:"package"`
	Metadata struct {
		Title     string   `xml:"title"`
		Language  string   `xml:"language"`
		Creator   []string `xml:"creator"`
		Publisher string   `xml:"publisher"`
	} `xml:"metadata"`
}

func TestConvertWithCalibre_EPUBToAZW3AndMOBI(t *testing.T) {
	requireTool(t, "ebook-convert")
	requireTool(t, "ebook-meta")

	inputPath := writeTestEPUB(t)
	defer os.Remove(inputPath)

	for _, formatTo := range []string{"azw3", "mobi"} {
		t.Run(formatTo, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			err := convertWithCalibre(context.Background(), recorder, inputPath, "epub", formatTo)
			if err != nil {
				t.Fatalf("convertWithCalibre failed: %v", err)
			}

			response := recorder.Result()
			defer response.Body.Close()
			if response.StatusCode != 200 {
				t.Fatalf("expected status 200, got %d", response.StatusCode)
			}

			body, err := io.ReadAll(response.Body)
			if err != nil {
				t.Fatalf("read response body failed: %v", err)
			}
			if len(body) == 0 {
				t.Fatal("expected non-empty converted output")
			}

			outPath := filepath.Join(t.TempDir(), "output."+formatTo)
			if err := os.WriteFile(outPath, body, 0o600); err != nil {
				t.Fatalf("write converted file failed: %v", err)
			}

			if err := assertEbookMetaReadable(outPath); err != nil {
				t.Fatalf("converted output is not readable by ebook-meta: %v", err)
			}
		})
	}
}

func TestApplyMetadataWithCalibre_UpdatesEPUBOPF(t *testing.T) {
	requireTool(t, "ebook-meta")

	inputPath := writeTestEPUB(t)
	defer os.Remove(inputPath)

	metadata := metadataPayload{
		Title:     "Updated Title",
		Authors:   []string{"Alice Writer", "Bob Editor"},
		Language:  "zh",
		Publisher: "Calibre Workers Press",
	}

	if err := applyMetadataWithCalibre(context.Background(), inputPath, metadata); err != nil {
		t.Fatalf("applyMetadataWithCalibre failed: %v", err)
	}

	if err := assertEbookMetaReadable(inputPath); err != nil {
		t.Fatalf("updated epub is not readable: %v", err)
	}

	opfBytes := mustReadOPF(t, inputPath)
	opfText := string(opfBytes)

	mustContain(t, opfText, "Updated Title")
	mustContain(t, opfText, "Alice Writer")
	mustContain(t, opfText, "Bob Editor")
	mustContain(t, opfText, "Calibre Workers Press")
	mustContain(t, opfText, ">zh<")
}

func requireTool(t *testing.T, name string) {
	t.Helper()
	if _, err := exec.LookPath(name); err != nil {
		t.Skipf("skip integration test: %s not found in PATH", name)
	}
}

func assertEbookMetaReadable(path string) error {
	cmd := exec.Command("ebook-meta", path)
	_, err := cmd.CombinedOutput()
	return err
}

func mustContain(t *testing.T, text string, expected string) {
	t.Helper()
	if !strings.Contains(text, expected) {
		t.Fatalf("expected %q in output", expected)
	}
}

func mustReadOPF(t *testing.T, epubPath string) []byte {
	t.Helper()

	reader, err := zip.OpenReader(epubPath)
	if err != nil {
		t.Fatalf("open epub as zip failed: %v", err)
	}
	defer reader.Close()

	for _, file := range reader.File {
		if strings.HasSuffix(strings.ToLower(file.Name), ".opf") {
			rc, err := file.Open()
			if err != nil {
				t.Fatalf("open opf entry failed: %v", err)
			}
			defer rc.Close()
			content, err := io.ReadAll(rc)
			if err != nil {
				t.Fatalf("read opf entry failed: %v", err)
			}
			return content
		}
	}

	t.Fatal("opf file not found in epub")
	return nil
}

func writeTestEPUB(t *testing.T) string {
	t.Helper()

	file, err := os.CreateTemp("", "test-*.epub")
	if err != nil {
		t.Fatalf("create temp epub failed: %v", err)
	}
	defer file.Close()

	zw := zip.NewWriter(file)

	mimetypeHeader := &zip.FileHeader{Name: "mimetype", Method: zip.Store}
	mimetypeWriter, err := zw.CreateHeader(mimetypeHeader)
	if err != nil {
		t.Fatalf("create mimetype entry failed: %v", err)
	}
	if _, err := mimetypeWriter.Write([]byte("application/epub+zip")); err != nil {
		t.Fatalf("write mimetype failed: %v", err)
	}

	if err := writeZipText(zw, "META-INF/container.xml", `<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`); err != nil {
		t.Fatal(err)
	}

	if err := writeZipText(zw, "OEBPS/content.opf", `<?xml version="1.0" encoding="utf-8"?>
<package version="2.0" unique-identifier="BookId" xmlns="http://www.idpf.org/2007/opf">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Original Title</dc:title>
    <dc:creator>Original Author</dc:creator>
    <dc:language>en</dc:language>
    <dc:publisher>Original Publisher</dc:publisher>
    <dc:identifier id="BookId">urn:uuid:test-book-id</dc:identifier>
  </metadata>
  <manifest>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine toc="ncx">
    <itemref idref="chapter"/>
  </spine>
</package>`); err != nil {
		t.Fatal(err)
	}

	if err := writeZipText(zw, "OEBPS/toc.ncx", `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="urn:uuid:test-book-id"/>
    <meta name="dtb:depth" content="1"/>
    <meta name="dtb:totalPageCount" content="0"/>
    <meta name="dtb:maxPageNumber" content="0"/>
  </head>
  <docTitle><text>Original Title</text></docTitle>
  <navMap>
    <navPoint id="navPoint-1" playOrder="1">
      <navLabel><text>Chapter 1</text></navLabel>
      <content src="chapter.xhtml"/>
    </navPoint>
  </navMap>
</ncx>`); err != nil {
		t.Fatal(err)
	}

	if err := writeZipText(zw, "OEBPS/chapter.xhtml", `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <head><title>Chapter 1</title></head>
  <body><p>Hello from test EPUB.</p></body>
</html>`); err != nil {
		t.Fatal(err)
	}

	if err := zw.Close(); err != nil {
		t.Fatalf("close epub writer failed: %v", err)
	}

	return file.Name()
}

func writeZipText(zw *zip.Writer, name string, content string) error {
	w, err := zw.Create(name)
	if err != nil {
		return err
	}
	_, err = io.Copy(w, bytes.NewBufferString(content))
	return err
}
