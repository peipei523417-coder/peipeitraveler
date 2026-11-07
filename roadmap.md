# Native version consistency

- [x] Remove Codemagic version overrides; keep Xcode as iOS source.
- [x] Add pre-build source checks and post-build IPA/AAB comparison gates.
- [x] Derive Android output names from the verified signed AAB version.
- [x] Display both source versions before manual store upload; disable Codemagic automatic upload.
- [x] Run six verifier tests and validate workflow YAML/shell syntax.
- [ ] Verify real IPA/AAB and store-upload versions — blocked: no artifacts or authenticated CI access in this sandbox; user must run existing CI and provide artifacts. No native builds, store upload, deployment or publishing performed.