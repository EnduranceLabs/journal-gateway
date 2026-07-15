class JournalGateway < Formula
  desc "Connect your tools to the Journal agent via an outbound WebSocket gateway"
  homepage "https://github.com/EnduranceLabs/journal-gateway"
  # url and sha256 are updated by packaging/homebrew/publish.sh.
  # Version 0.7.0 was published under the previous scoped npm name; the next
  # formula update will point at the unscoped journal-gateway tarball.
  url "https://registry.npmjs.org/journal-gateway/-/journal-gateway-0.8.0.tgz"
  sha256 "f98ba9d77f56a5cf2abff6aaea93cbee6801e6c2f497527d9b5b32bfd5d7d945"
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
