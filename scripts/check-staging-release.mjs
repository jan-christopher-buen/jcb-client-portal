// Runs before dependency installation; intentionally uses only Node built-ins.
const { JCB_RELEASE_SHA, RENDER_GIT_COMMIT } = process.env
if (
  JCB_RELEASE_SHA?.length !== 40 ||
  !/^[0-9a-f]{40}$/.test(JCB_RELEASE_SHA ?? '') ||
  JCB_RELEASE_SHA !== RENDER_GIT_COMMIT
) {
  console.error(
    'Staging build refused: configure the approved full release SHA and deploy that exact commit.',
  )
  process.exitCode = 1
}
