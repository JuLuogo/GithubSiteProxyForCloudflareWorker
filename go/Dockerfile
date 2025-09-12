# 使用官方 Go 镜像进行编译
FROM golang:1.19-alpine as builder
WORKDIR /app
COPY go.mod .
COPY main.go .
RUN go build -o /app/server .

# 使用一个极简的 alpine 镜像来运行程序
FROM alpine:latest
WORKDIR /root/
COPY --from=builder /app/server .
EXPOSE 8080
CMD ["./server"]
