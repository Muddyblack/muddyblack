{
  description = "muddyblack-card — dev shell for the Cloudflare Worker";

  inputs.nixpkgs.url = "github:nixos/nixpkgs/nixos-unstable";

  outputs = {
    self,
    nixpkgs,
  }: let
    systems = ["x86_64-linux" "aarch64-linux" "aarch64-darwin" "x86_64-darwin"];
    forEachSystem = nixpkgs.lib.genAttrs systems;
  in {
    devShells = forEachSystem (system: let
      pkgs = nixpkgs.legacyPackages.${system};
    in {
      default = pkgs.mkShell {
        # wrangler comes from nixpkgs, not npm, on purpose: the npm package
        # ships workerd as a prebuilt dynamically-linked binary that will not
        # run on NixOS without patching. The nixpkgs build is already patched.
        packages = [pkgs.nodejs_24 pkgs.wrangler];

        shellHook = ''
          echo "☁️  worker shell — node $(node --version), wrangler $(wrangler --version 2>/dev/null | head -1)"
          echo "   wrangler login · wrangler secret put GITHUB_TOKEN · wrangler dev · wrangler deploy"
        '';
      };
    });
  };
}
