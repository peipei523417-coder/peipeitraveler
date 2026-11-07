# Native version consistency

- [ ] Remove Codemagic version overrides; keep Xcode as iOS source.
- [ ] Check source versions before builds and compare actual IPA/AAB versions afterward.
- [ ] Derive Android output names from the verified AAB version.
- [ ] Display both source versions before manual store upload; do not upload automatically.
- [ ] Run verification tests; read real IPA/AAB files if available, otherwise report the blocker.