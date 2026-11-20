# Technical references (official)

GitHub Container Registry and package access:
- https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry
- https://docs.github.com/en/packages/learn-github-packages/configuring-a-packages-access-control-and-visibility
- https://docs.github.com/en/packages/managing-github-packages-using-github-actions-workflows/publishing-and-installing-a-package-with-github-actions
- https://docs.github.com/en/actions/tutorials/publish-packages/publish-docker-images

GitHub Actions trust and build attestations:
- https://docs.github.com/en/actions/security-guides/security-hardening-for-github-actions
- https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments
- https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/use-artifact-attestations
- https://github.com/actions/attest
- https://cli.github.com/manual/gh_attestation_verify
- https://github.com/cli/cli/security/advisories/GHSA-wjmr-j3rp-mh2g

Signature verification, policy, image comparison and scanning:
- https://docs.sigstore.dev/cosign/system_config/registry_support/
- https://github.com/sigstore/cosign
- https://kyverno.io/docs/policy-types/image-validating-policy/
- https://github.com/reproducible-containers/diffoci
- https://github.com/google/go-containerregistry/tree/main/cmd/crane
- https://github.com/anchore/syft
- https://github.com/anchore/grype
- https://docs.renovatebot.com/docker/
- https://slsa.dev/spec/v1.0/

Verify action inputs, GHCR permissions and Cosign/Kyverno policy semantics against the exact versions you deploy. These references are not evidence that the project passed live integration testing.
