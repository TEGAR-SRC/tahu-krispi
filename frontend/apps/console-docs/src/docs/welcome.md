# Kilat Cloud Documentation

Welcome to the Kilat Cloud documentation. This is a **Markdown**-powered documentation site with **syntax highlighting** for code blocks.

## Features

- Renders GitHub-Flavored Markdown (tables, strikethrough, task lists, auto-links)
- Syntax highlighting for code blocks via `rehype-highlight`
- Sidebar with a list of documents and full-text search
- Lightweight, fast, self-contained

## Quick start

```bash
# install dependencies
npm install

# run the docs site
npm run dev -w apps/console-docs

# build for production
npm run build -w apps/console-docs
```

## A table example

| Feature          | Status |
| ---------------- | ------ |
| Markdown        | ✅ done |
| Syntax highlight | ✅ done |
| Search          | ✅ done |

> This is a blockquote with a [link](https://kilat-cloud.com) and `inline code`.

## Task list

- [x] Set up docs project
- [x] Add markdown rendering
- [x] Add syntax highlighting
- [ ] Deploy

## Something strikethrough

~~this is no longer relevant~~
