class JournalGateway < Formula
  desc "Connect your tools to the Journal agent via an outbound WebSocket gateway"
  homepage "https://github.com/EnduranceLabs/journal-gateway"
  # url and sha256 are updated by packaging/homebrew/publish.sh.
  url "https://registry.npmjs.org/journal-gateway/-/journal-gateway-0.8.1.tgz"
  sha256 "b27d1445ca82eaed906363c881f9e1f04f3fc578e994fccb99b3c8cf2d285086"
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
