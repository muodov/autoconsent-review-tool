# Autoconsent PR reviewer

> Note: This is merely a helper tool, use with caution.

A simple web-based tool for reviewing and Jenkins CI test results from the [Autoconsent](https://github.com/duckduckgo/autoconsent) project. It is specifically made to help with reviewing [auto-generated PRs](https://github.com/duckduckgo/autoconsent/pull/885).

## How to use it
1. Open the [reviewer](https://zok.pw/autoconsent-review-tool/) app in your browser (you can also clone the repo and open index.html locally).
2. Download Jenkins artifacts as a ZIP file.
3. Upload the ZIP file to the app.

The tool visualizes all test results and corresponding screenshots. You can "keep" the change if it looks like a success, or "rollback" it. In the latter case, the tool will generate a git revert command for you, that you'll need to run manually in the Autoconsent repo.

## Test results are grouped by failure reason

<img width="1155" height="620" alt="image" src="https://github.com/user-attachments/assets/71039ef2-3a79-437d-b651-8ac278a34bc8" />

## Each test has screenshots next to it

<img width="1549" height="890" alt="image" src="https://github.com/user-attachments/assets/94fc457a-fc2f-47ec-98d0-6446ce70bd07" />

## Generate a rollback shell command

<img width="1152" height="895" alt="image" src="https://github.com/user-attachments/assets/8955bbce-1a74-463c-abbe-88ee6aaaa98b" />
