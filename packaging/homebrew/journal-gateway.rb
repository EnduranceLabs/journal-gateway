class JournalGateway < Formula
  desc "Connect your tools to the Journal agent via an outbound WebSocket gateway"
  homepage "https://github.com/EnduranceLabs/journal-gateway"
  # url and sha256 are updated by packaging/homebrew/publish.sh.
  # Version 0.7.0 was published under the previous scoped npm name; the next
  # formula update will point at the unscoped journal-gateway tarball.
  url "https://registry.npmjs.org/@journal.one/gateway/-/gateway-0.7.0.tgz"
  sha256 "5e495d9a9d1f00d925ac0be3806ba6cbf794966c49cc9734bdd02813e8ec0c97"
  license "MIT"

  depends_on "node@22"

  def install
    system "npm", "install", *std_npm_args
    bin.install_symlink Dir["#{libexec}/bin/*"]
  end

  test do
    assert_match "JOURNAL_GATEWAY_TOKEN is required",
      shell_output("#{bin}/journal-gateway 2>&1", 1)
  end
end
