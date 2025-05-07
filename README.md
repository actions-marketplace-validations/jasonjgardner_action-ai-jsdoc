# AI JSDoc Generator GitHub Action

A GitHub Action that automatically generates and suggests JSDoc comments for your JavaScript and TypeScript code in pull requests using the Vercel AI SDK.

[![GitHub Release](https://img.shields.io/github/v/release/yourusername/ai-jsdoc-generator.svg)](https://github.com/yourusername/ai-jsdoc-generator/releases)
[![License: Apache](https://img.shields.io/badge/License-Apache-yellow.svg)](https://opensource.org/licenses/Apache)


## Overview

This GitHub Action leverages the Vercel AI SDK with OpenAI to analyze JavaScript and TypeScript functions in your pull requests. It can either add review comments with JSDoc suggestions that can be applied with a single click, or commit the JSDoc comments directly to your branch.

## Features

- ✨ Uses AST parsing to accurately detect functions, methods, and classes
- 📝 Generates detailed JSDoc comments using AI
- 💬 Two modes: add suggestions as review comments or commit directly
- 🔍 Only processes functions without existing JSDoc comments
- 📊 Adds a summary comment to the PR with statistics

## Usage

Add the following to your GitHub workflow file (e.g., `.github/workflows/jsdoc-generator.yml`):

```yaml
name: AI JSDoc Generator

on:
  pull_request:
    types: [opened, synchronize]

jobs:
  generate-jsdoc:
    runs-on: ubuntu-latest
    permissions:
      contents: write
      pull-requests: write
    
    steps:
      - name: Generate JSDoc Comments
        uses: yourusername/ai-jsdoc-generator@v1
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          openai-api-key: ${{ secrets.OPENAI_API_KEY }}
          # Optional configurations:
          # review-mode: 'suggestion'  # or 'commit'
          # openai-model: 'gpt-4'
          # include-files: '**/*.{js,jsx,ts,tsx}'
          # exclude-files: 'node_modules/**,dist/**'
          # temperature: '0.2'
```

## Configuration Options

| Option | Description | Required | Default |
|--------|-------------|----------|---------|
| `github-token` | GitHub token with permission to create PR comments and reviews | Yes | `${{ github.token }}` |
| `openai-api-key` | Your OpenAI API key | Yes | N/A |
| `review-mode` | How to submit changes: `suggestion` (PR review comments) or `commit` (direct commits) | No | `suggestion` |
| `openai-model` | OpenAI model to use for generating JSDoc comments | No | `gpt-3.5-turbo` |
| `include-files` | Glob pattern for files to process | No | `**/*.{js,jsx,ts,tsx}` |
| `exclude-files` | Glob pattern for files to exclude | No | `node_modules/**,dist/**,build/**,coverage/**` |
| `temperature` | Temperature value for OpenAI API (0.0 to 1.0) | No | `0.2` |

## Example Outputs

### Suggestion Mode

When using `review-mode: 'suggestion'`, the action adds review comments with suggested JSDoc blocks:


The PR author can click "Commit suggestion" to apply the JSDoc comment directly to the code.

### Commit Mode

When using `review-mode: 'commit'`, the action commits JSDoc comments directly to your branch:

## How It Works

1. The action runs on pull request events (open, synchronize)
2. It uses AST parsing (via `@babel/parser`) to accurately detect functions in your code
3. For each function without existing JSDoc, it generates appropriate comments using the Vercel AI SDK with OpenAI
4. Depending on the `review-mode`, it either:
   - Creates PR review comments with suggestions that can be applied with a click
   - Commits the JSDoc comments directly to your branch
5. It adds a summary comment to the PR with statistics about the process

## Requirements

- An OpenAI API key
- Permissions: `contents: write` and `pull-requests: write`

## Troubleshooting

- **No suggestions/comments appearing**: Ensure that your files contain functions without JSDoc comments and that they're included in the PR.
- **API rate limiting**: If you hit OpenAI API rate limits, try using a different model or adjusting the temperature.
- **Parsing errors**: For complex code structures, you might need to exclude specific files using the `exclude-files` option.

## Local Development

To contribute to this action:

1. Clone the repository
2. Install dependencies: `npm install`
3. Make your changes
4. Test locally:
   ```bash
   INPUT_GITHUB-TOKEN=your_github_token \
   INPUT_OPENAI-API-KEY=your_openai_key \
   node scripts/suggest-jsdoc.cjs
   ```

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Credits

- AST parsing powered by [@babel/parser](https://babeljs.io/docs/en/babel-parser)
- AI capabilities provided by [Vercel AI SDK](https://sdk.vercel.ai/)

---
(Claude made this whole dang thing.)