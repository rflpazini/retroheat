# syntax=docker/dockerfile:1

FROM golang:1.27-alpine AS build
WORKDIR /src

COPY go.mod go.sum ./
COPY cmd ./cmd
COPY internal ./internal

RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 go build -trimpath -o /out/collector ./cmd/collector

FROM alpine:3.21
# The eBay and IGDB APIs are HTTPS-only, so the runtime needs root certificates.
RUN apk add --no-cache ca-certificates
COPY --from=build /out/collector /usr/local/bin/collector

ENTRYPOINT ["collector"]
CMD ["-fake", "-data", "/data", "-catalog", "/catalog"]
