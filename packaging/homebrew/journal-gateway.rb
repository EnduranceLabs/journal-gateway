class JournalGateway < Formula
  desc "Connect your tools to the Journal agent via an outbound WebSocket gateway"
  homepage "https://github.com/journal/journal-edge"
  # url and sha256 are updated by publish-homebrew.sh
  url "https://registry.npmjs.org/@journal/gateway/-/gateway-0.1.0.tgz"
  sha256 "PLACEHOLDER"
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
