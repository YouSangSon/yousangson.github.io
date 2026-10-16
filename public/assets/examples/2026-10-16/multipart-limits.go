// Independent parser experiment. Run with Go 1.24.5: go run multipart-limits.go
package main

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"runtime"
)

func check(err error) {
	if err != nil {
		panic(err)
	}
}

func body(size int) ([]byte, string) {
	var b bytes.Buffer
	w := multipart.NewWriter(&b)
	check(w.SetBoundary("study-boundary"))
	p, err := w.CreateFormFile("file", "sample.bin")
	check(err)
	_, err = p.Write(bytes.Repeat([]byte{'x'}, size))
	check(err)
	check(w.Close())
	return b.Bytes(), w.FormDataContentType()
}

func inspect(payload []byte, contentType string, bodyLimit, fileLimit int64) string {
	r := httptest.NewRequest(http.MethodPost, "/upload", bytes.NewReader(payload))
	r.Header.Set("Content-Type", contentType)
	r.Body = http.MaxBytesReader(httptest.NewRecorder(), r.Body, bodyLimit)
	defer r.Body.Close()
	if err := r.ParseMultipartForm(8); err != nil {
		var limitError *http.MaxBytesError
		if errors.As(err, &limitError) {
			return "body rejected"
		}
		panic(err)
	}
	defer func() { check(r.MultipartForm.RemoveAll()) }()
	f, _, err := r.FormFile("file")
	check(err)
	defer f.Close()
	n, err := io.Copy(io.Discard, io.LimitReader(f, fileLimit+1))
	check(err)
	if n > fileLimit {
		return "file rejected"
	}
	return "accepted"
}

func main() {
	fmt.Println(runtime.Version())
	for _, tc := range []struct {
		file      int
		bodyLimit int64
		want      string
	}{
		{1024, 1024, "body rejected"},
		{1024, 2048, "accepted"},
		{1025, 2048, "file rejected"},
	} {
		payload, contentType := body(tc.file)
		got := inspect(payload, contentType, tc.bodyLimit, 1024)
		if got != tc.want {
			panic(fmt.Sprintf("want %s, got %s", tc.want, got))
		}
		fmt.Printf("file=%d body=%d bodyLimit=%d: %s\n", tc.file, len(payload), tc.bodyLimit, got)
	}
}
