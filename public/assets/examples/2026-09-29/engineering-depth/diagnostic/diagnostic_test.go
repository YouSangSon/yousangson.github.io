package diagnostic

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

type countedBody struct {
	io.ReadCloser
	read int
}

func (b *countedBody) Read(p []byte) (int, error) {
	n, err := b.ReadCloser.Read(p)
	b.read += n
	return n, err
}

// This is an observation model, not a production HTTP handler or auth system.
type observation struct {
	status   int
	read     int
	body     string
	supplied string
	resolved string
}

func inspect(req *http.Request, verifiedPrincipal string) (out observation) {
	body := &countedBody{ReadCloser: req.Body}
	req.Body = body
	defer func() { out.read = body.read }()
	out.supplied = strings.TrimPrefix(req.URL.Path, "/notes/")
	if verifiedPrincipal == "" {
		out.status, out.body = http.StatusUnauthorized, "not-read"
		return
	}
	var fields map[string]json.RawMessage
	if err := json.NewDecoder(req.Body).Decode(&fields); err != nil {
		out.status, out.body = http.StatusBadRequest, "invalid"
		return
	}
	out.body = "parsed"
	if len(fields) == 0 {
		out.body = "parsed-empty"
	}
	owner, exists := map[string]string{"n42": "reader", "n43": "other"}[out.supplied]
	if !exists {
		out.status = http.StatusNotFound
		return
	}
	if owner != verifiedPrincipal {
		out.status = http.StatusForbidden
		return
	}
	out.resolved, out.status = out.supplied, http.StatusOK
	return
}

func TestObservationStages(t *testing.T) {
	cases := []struct {
		name, principal, path, payload string
		want                           observation
	}{
		{"before-auth", "", "/notes/n42", `{}`, observation{401, 0, "not-read", "n42", ""}},
		{"parsed-empty", "reader", "/notes/n42", `{}`, observation{200, 2, "parsed-empty", "n42", "n42"}},
		{"parser-reject", "reader", "/notes/n42", `{`, observation{400, 1, "invalid", "n42", ""}},
		{"authorization-reject", "reader", "/notes/n43", `{}`, observation{403, 2, "parsed-empty", "n43", ""}},
		{"redacted", "reader", "/notes/n42", `{"secret":"demo-secret"}`, observation{200, 24, "parsed", "n42", "n42"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodPost, tc.path, strings.NewReader(tc.payload))
			got := inspect(req, tc.principal)
			if got != tc.want {
				t.Fatalf("got %+v; want %+v", got, tc.want)
			}
			if strings.Contains(fmt.Sprintf("%+v", got), "demo-secret") {
				t.Fatal("raw request value escaped into observation")
			}
			t.Logf("status=%d body=%s read=%d supplied=%s resolved=%s", got.status, got.body, got.read, got.supplied, got.resolved)
		})
	}
}
