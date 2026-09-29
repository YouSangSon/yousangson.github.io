package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"runtime"
	"strings"

	"github.com/minio/minio-go/v7"
)

var stop = errors.New("probe: stop at first Read")

// No network: only multipart initiation and abort are accepted.
type fakeTransport struct{}

func (fakeTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	status, body := http.StatusOK, ""
	switch {
	case r.Method == "POST" && r.URL.Query().Has("uploads"):
		body = `<InitiateMultipartUploadResult><Bucket>demo-bucket</Bucket><Key>demo</Key><UploadId>probe</UploadId></InitiateMultipartUploadResult>`
	case r.Method == "DELETE" && r.URL.Query().Get("uploadId") == "probe":
		status = http.StatusNoContent
	default:
		return nil, fmt.Errorf("unexpected request: %s %s", r.Method, r.URL.Path)
	}
	return &http.Response{StatusCode: status, Header: make(http.Header),
		Body: io.NopCloser(strings.NewReader(body)), Request: r}, nil
}

type probeReader struct {
	before uint64
	want   int64
	called bool
}

func (p *probeReader) Read(b []byte) (int, error) {
	var m runtime.MemStats
	runtime.ReadMemStats(&m)
	p.called = true
	if int64(len(b)) != p.want || m.TotalAlloc-p.before < uint64(p.want) {
		panic("buffer observation differs from prediction")
	}
	fmt.Printf("Read buffer=%.0f MiB; allocated before Read=%.2f MiB\n",
		float64(len(b))/(1<<20), float64(m.TotalAlloc-p.before)/(1<<20))
	return 0, stop
}

func main() {
	client, err := minio.New("example.invalid", &minio.Options{
		Region: "us-east-1", Transport: fakeTransport{},
	})
	if err != nil {
		panic(err)
	}
	for _, configured := range []uint64{0, 8 << 20} {
		_, size, _, err := minio.OptimalPartInfo(-1, configured)
		if err != nil {
			panic(err)
		}
		runtime.GC()
		var before runtime.MemStats
		runtime.ReadMemStats(&before)
		reader := &probeReader{before: before.TotalAlloc, want: size}
		_, err = client.PutObject(context.Background(), "demo-bucket", "demo",
			reader, -1, minio.PutObjectOptions{PartSize: configured})
		if !reader.called || !errors.Is(err, stop) {
			panic(fmt.Sprintf("unexpected upload result: %v", err))
		}
	}
}
