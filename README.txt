每周文献速递 · 在线版（可托管 / 可局域网分享）

整页布局（顶部只有 logo，内容铺满页面）。
和单文件独立版的区别：这个版本的页面不内联数据，而是打开时去读同目录的 data/。
所以只要替换 data/index.json 与 data/issues/*.json，别人刷新页面就能看到新一期。

用法一：本机/局域网
  node serve.mjs            # 默认 8099 端口，然后访问 http://127.0.0.1:8099/
  同事访问 http://<你的内网IP>:8099/

用法二：丢到任意静态服务器（Nginx / IIS / GitHub Pages / 对象存储）
  把整个目录上传即可，入口 index.html。

更新：在插件目录跑 node scripts/build-standalone.mjs --site，再把新目录覆盖上去。