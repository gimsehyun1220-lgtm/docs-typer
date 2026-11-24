# Docs Typer

Docs Typer is a Chrome side panel extension that types a finished draft into Google Docs at a pace you choose. You can change the speed or pause while it runs. Afterward, compare the text in Docs with your draft to see where they first differ.

## Install

[Download the installation ZIP](https://github.com/gimsehyun1220-lgtm/docs-typer/releases/download/v0.1.8/docs-typer-0.1.8.zip) · [v0.1.8 pre-release notes](https://github.com/gimsehyun1220-lgtm/docs-typer/releases/tag/v0.1.8)

Requires Chrome 118 or later.

1. Download and extract `docs-typer-0.1.8.zip`.
2. Open `chrome://extensions` and turn on **Developer mode**.
3. Click **Load unpacked** and select the folder containing `manifest.json`.
4. Select **Docs Typer** from Chrome's Extensions menu to open the side panel.

## Use

The v0.1.8 side panel is in Korean.

1. Open a blank Google Doc you can edit and place the cursor where you want the text to begin.
2. Paste your draft into the side panel and choose a speed. Check the target document title, select the confirmation checkbox, and start typing.
3. You can change the speed, pause, or stop while the extension is typing. Before resuming, make sure the cursor is at the right spot in the same document. If the extension is unsure whether the last character was inserted, it will ask you to check the document.
4. When typing finishes, copy the body text from Google Docs and paste it into the comparison section. The panel shows both texts in full, counts their characters, and scrolls both to the first difference.

The extension handles Korean, English, and emoji as visible characters and sends line breaks as Enter keystrokes. Replace tabs and other unsupported control characters with spaces before typing.

Pause before moving the cursor or editing the target document. You can switch to another browser tab while typing continues in the original document. Closing the target tab, leaving the document, or switching tabs within the document pauses the job. Closing the side panel stops it.

Typing speed ranges from 15 to 100 words per minute (WPM), with a default of 40. The extension counts five characters as one word. Timing varies in groups of 8 to 12 characters while targeting the selected average pace. At 40 WPM, the target interval is about 195 to 405 ms per character. Actual timing depends on Chrome and how quickly the document responds.

## Permissions and data

The Chrome `debugger` permission allows an extension to debug browser tabs. Docs Typer uses it to send input to the confirmed Google Docs tab after checking that the editor has focus. Chrome may display a debugging banner. Docs Typer detaches when typing pauses or ends.

The extension keeps your draft and progress in memory while it runs. Google Docs saves edits and controls how they appear in version history. To verify the result, check that typing finished and compare the saved document against your draft.

## Development

- To install from source, use Node.js 22 or later. Run `npm ci` and `npm run build`, then load the `dist` folder in Chrome.
- `npm test` builds the TypeScript project and runs tests for typing speed, Unicode, interruption, and resuming. The worker tests use mocked Chrome APIs.
- `npm run package` uses the `zip` command to create `release/docs-typer-0.1.8.zip` for GitHub Releases.
- To update an unpacked installation, load the new folder or replace the files in the existing folder and click **Reload** on the extension's card in `chrome://extensions`.

The start and stop controls were inspired by [LazyTyper](https://github.com/lykon7/LazyTyper) and [Auto-Type](https://github.com/GitLitAF/Auto-Type).
