// Synthetic response and PATCH model. Run with: go run main.go
package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"slices"
)

type response struct {
	Labels []string `json:"labels"`
}
type listResponse struct {
	Items []response `json:"items"`
}
type pointerPatch struct {
	Labels *[]string `json:"labels"`
}

func encode(value any) string {
	data, err := json.Marshal(value)
	if err != nil {
		panic(err)
	}
	return string(data)
}

func labelsResponse(stored []string) response {
	if stored == nil {
		stored = []string{}
	}
	return response{Labels: stored}
}

// This example defines its own PATCH document: absent = keep, [] = clear,
// null = invalid. It is not application/merge-patch+json.
func applyLabelsPatch(current []string, body []byte) ([]string, error) {
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(body, &fields); err != nil {
		return nil, err
	}
	if fields == nil {
		return nil, fmt.Errorf("PATCH body must be an object")
	}
	for name := range fields {
		if name != "labels" {
			return nil, fmt.Errorf("unknown field %q", name)
		}
	}
	raw, present := fields["labels"]
	if !present {
		return current, nil
	}
	if bytes.Equal(bytes.TrimSpace(raw), []byte("null")) {
		return nil, fmt.Errorf("labels cannot be null")
	}
	var items []*string
	if err := json.Unmarshal(raw, &items); err != nil {
		return nil, err
	}
	next := make([]string, len(items))
	for i, item := range items {
		if item == nil {
			return nil, fmt.Errorf("labels[%d] cannot be null", i)
		}
		next[i] = *item
	}
	return next, nil
}

func main() {
	if encode(response{Labels: nil}) != `{"labels":null}` ||
		encode(response{Labels: []string{}}) != `{"labels":[]}` {
		panic("nil and empty slices encoded unexpectedly")
	}
	if encode(struct {
		Labels []string `json:"labels,omitempty"`
	}{Labels: []string{}}) != `{}` {
		panic("omitempty did not omit an empty slice")
	}
	got := encode(labelsResponse(nil))
	outer := encode(listResponse{Items: []response{}})
	if got != `{"labels":[]}` || outer != `{"items":[]}` {
		panic("response boundary did not normalize lists")
	}
	fmt.Println("GET nil stored list:", got)
	fmt.Println("GET empty outer list:", outer)

	var absent, explicitNull pointerPatch
	if json.Unmarshal([]byte(`{}`), &absent) != nil ||
		json.Unmarshal([]byte(`{"labels":null}`), &explicitNull) != nil ||
		absent.Labels != nil || explicitNull.Labels != nil {
		panic("pointer distinction changed")
	}
	fmt.Println("pointer DTO distinguishes absent/null:", false)

	var naive []string
	if err := json.Unmarshal([]byte(`["x",null]`), &naive); err != nil ||
		!slices.Equal(naive, []string{"x", ""}) {
		panic("Go null-element decoding changed")
	}
	fmt.Println("direct []string decode [x,null]:", encode(naive))

	current := []string{"old"}
	kept, err := applyLabelsPatch(current, []byte(`{}`))
	if err != nil || !slices.Equal(kept, current) {
		panic("omission must retain current value")
	}
	cleared, err := applyLabelsPatch(current, []byte(`{"labels":[]}`))
	if err != nil || cleared == nil || len(cleared) != 0 {
		panic("empty array must clear the list")
	}
	_, err = applyLabelsPatch(current, []byte(`{"labels":null}`))
	if err == nil {
		panic("null must be rejected")
	}
	for _, body := range []string{`{"labels":[null]}`, `{"labels":["x",null]}`} {
		if _, err := applyLabelsPatch(current, []byte(body)); err == nil {
			panic("null array member must be rejected")
		}
	}
	replaced, err := applyLabelsPatch(current, []byte(`{"labels":["new"]}`))
	if err != nil || !slices.Equal(replaced, []string{"new"}) {
		panic("non-empty array must replace the list")
	}
	fmt.Println("PATCH {}:", encode(labelsResponse(kept)))
	fmt.Println("PATCH []:", encode(labelsResponse(cleared)))
	fmt.Println("PATCH null: rejected")
	fmt.Println("PATCH [null] and [x,null]: rejected")
	fmt.Println("PATCH [new]:", encode(labelsResponse(replaced)))
}
