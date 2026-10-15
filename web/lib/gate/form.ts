export function formHtml(failed: boolean): string {
  const message = failed ? "<p>Incorrect passcode.</p>" : "";
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Harness demo</title>
</head>
<body>
<main>
<h1>Harness demo</h1>
${message}<form method="post" data-harness-gate="passcode">
<label for="passcode">Passcode</label>
<input id="passcode" name="passcode" type="password" autocomplete="current-password" required>
<button type="submit">Continue</button>
</form>
</main>
</body>
</html>
`;
}
