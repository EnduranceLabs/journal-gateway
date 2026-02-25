class JournalGateway < Formula
  desc "Connect your tools to the Journal agent via an outbound WebSocket gateway"
  homepage "https://github.com/journal/journal-edge"
  # url and sha256 are updated by packaging/homebrew/publish.sh
  url "https://registry.npmjs.org/@journal.one/gateway/-/gateway-0.2.0.tgz"
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
