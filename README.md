# Autoconsent PR reviewer

> Note: This is merely a helper tool, use with caution.

A simple web-based tool for reviewing and Jenkins CI test results from the [Autoconsent](https://github.com/duckduckgo/autoconsent) project. It is specifically made to help with reviewing [auto-generated PRs](https://github.com/duckduckgo/autoconsent/pull/885).

## How to use it
1. Open the [reviewer](https://zok.pw/autoconsent-review-tool/) app in your browser (you can also clone the repo and open index.html locally).
2. Download Jenkins artifacts as a ZIP file.
3. Upload the ZIP file to the app.

The tool visualizes all test results and corresponding screenshots. You can "keep" the change if it looks like a success, or "rollback" it. In the latter case, the tool will generate a git revert command for you, that you'll need to run manually in the Autoconsent repo.
