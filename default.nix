{ pkgs ? import <nixpkgs> { } }:
pkgs.mkYarnPackage {
  name = "hiccup-catcher";
  src = builtins.filterSource
    (path: type: type != "directory" || baseNameOf path != "bin")
    ./.;
  buildPhase = ''
    yarn build
  '';
  postInstall = ''
    chmod +x $out/bin/hiccup-catcher
  '';
  packageJSON = ./package.json;
  yarnLock = ./yarn.lock;
  yarnNix = ./yarn.nix;
}
