# codexer (vendored)

OpenAI / ChatGPT OAuth proxy — embedded in AI-proxy so no separate checkout is needed.

**Upstream:** https://github.com/vladvlsu/codexer

Built by `npm run install-binaries` → `resources/bin/codexer`.

To refresh from upstream:

```bash
rsync -a --delete --exclude .git \
  <(git clone --depth 1 https://github.com/vladvlsu/codexer /tmp/codexer-sync && echo /tmp/codexer-sync) \
  ./codexer/
```

Or manually merge changes from upstream releases.
