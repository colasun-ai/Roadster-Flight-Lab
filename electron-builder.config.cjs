module.exports={
 appId:'com.colasun.roadsterflightlab',productName:'Roadster Flight Lab',copyright:'Local experimental simulator',
 directories:{output:'desktop-build',buildResources:'build-assets'},
 files:['dist/**/*','desktop/**/*','src/i18n/catalogs/*.json','build-assets/icon.png','package.json','!node_modules/**/*'],asar:true,npmRebuild:false,
 mac:{extraResources:[{from:process.env.ROADSTER_MAC_ARCH==='x64'?'desktop-build/runtime-mac-x64':'fsd-runtime',to:'fsd-runtime',filter:['**/*','!**/__pycache__/**','!**/*.pyc','!site-packages/torch/include/**','!python/include/**','!python/share/**','!python/lib/pkgconfig/**']}],target:[{target:'dir',arch:[process.env.ROADSTER_MAC_ARCH||'arm64']}],category:'public.app-category.simulation-games',icon:'build-assets/icon.icns',identity:'-',hardenedRuntime:true,entitlements:'build-assets/entitlements.mac.plist',entitlementsInherit:'build-assets/entitlements.mac.plist',notarize:false},
 win:{extraResources:[{from:'fsd-runtime-win',to:'fsd-runtime'}],target:[{target:'portable',arch:['x64']}],icon:'build-assets/icon.ico',signExecutable:false,requestedExecutionLevel:'asInvoker'},
 portable:{artifactName:'Roadster-Flight-Lab-${version}-Windows-x64.exe',requestExecutionLevel:'user'},
 beforePack:require('./desktop/check-windows-runtime.cjs'),
 afterPack:require('./desktop/before-sign.cjs'),publish:null
};
