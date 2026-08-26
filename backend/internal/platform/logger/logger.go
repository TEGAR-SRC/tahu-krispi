// Package logger provides a structured JSON logger.
package logger

import (
	"encoding/json"
	"io"
	"os"
	"sync"
	"time"
)

type Level int

const (
	LevelDebug Level = iota
	LevelInfo
	LevelWarn
	LevelError
)

var levelNames = map[Level]string{
	LevelDebug: "debug",
	LevelInfo:  "info",
	LevelWarn:  "warn",
	LevelError: "error",
}

type Logger struct {
	mu    sync.Mutex
	out   io.Writer
	level Level
}

func New(level string) *Logger {
	l := LevelInfo
	switch level {
	case "debug":
		l = LevelDebug
	case "warn":
		l = LevelWarn
	case "error":
		l = LevelError
	}
	return &Logger{out: os.Stdout, level: l}
}

func (l *Logger) log(level Level, msg string, fields map[string]any) {
	if level < l.level {
		return
	}
	entry := map[string]any{
		"ts":    time.Now().UTC().Format(time.RFC3339Nano),
		"level": levelNames[level],
		"msg":   msg,
	}
	for k, v := range fields {
		entry[k] = v
	}
	b, err := json.Marshal(entry)
	if err != nil {
		return
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	l.out.Write(append(b, '\n'))
}

func (l *Logger) Debug(msg string, fields map[string]any) { l.log(LevelDebug, msg, fields) }
func (l *Logger) Info(msg string, fields map[string]any)  { l.log(LevelInfo, msg, fields) }
func (l *Logger) Warn(msg string, fields map[string]any)  { l.log(LevelWarn, msg, fields) }
func (l *Logger) Error(msg string, fields map[string]any) { l.log(LevelError, msg, fields) }

// With returns a new logger that always includes the given fields.
func (l *Logger) With(fields map[string]any) *FieldsLogger {
	return &FieldsLogger{l: l, fields: fields}
}

type FieldsLogger struct {
	l      *Logger
	fields map[string]any
}

func (fl *FieldsLogger) Debug(msg string, extra map[string]any) {
	fl.l.log(LevelDebug, msg, fl.merge(extra))
}
func (fl *FieldsLogger) Info(msg string, extra map[string]any) {
	fl.l.log(LevelInfo, msg, fl.merge(extra))
}
func (fl *FieldsLogger) Warn(msg string, extra map[string]any) {
	fl.l.log(LevelWarn, msg, fl.merge(extra))
}
func (fl *FieldsLogger) Error(msg string, extra map[string]any) {
	fl.l.log(LevelError, msg, fl.merge(extra))
}

func (fl *FieldsLogger) merge(extra map[string]any) map[string]any {
	m := make(map[string]any, len(fl.fields)+len(extra))
	for k, v := range fl.fields {
		m[k] = v
	}
	for k, v := range extra {
		m[k] = v
	}
	return m
}
