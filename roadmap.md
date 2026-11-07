# Native version consistency

- [x] Remove Codemagic version overrides; keep Xcode as iOS source.
- [x] Add pre-build source checks and post-build IPA/AAB comparison gates.
- [x] Derive Android output names from the verified signed AAB version.
- [x] Preserve iOS automatic App Store Connect/TestFlight upload after snapshot and explicit 6.1.81 / 123 IPA verification; never submit to App Store review.
- [x] Keep Android signed AAB download and manual Google Play upload unchanged.
- [x] Test Codemagic publishing configuration and verify mismatched IPAs never enter the publishing directory (six fixture/configuration tests passed).
- [x] Run six verifier tests and validate workflow YAML/shell syntax.
- [ ] Verify real IPA/AAB and store-upload versions — blocked: no artifacts or authenticated CI access in this sandbox; user must run existing CI and provide artifacts. No native builds, store upload, deployment or publishing performed.