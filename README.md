# Web Translate

在网页上选中文字，一点就译。

[官网](https://la-yee.com) · 当前版本 **v0.1.1**

Web Translate 是一款浏览器翻译插件，支持 Chrome 和 Edge。选中文字后，旁边会出现「翻译」按钮，译文直接显示在页面上，不用切标签、不用复制粘贴。

还没有账号？[前往 la-yee.com 注册 →](https://la-yee.com)

---

## 安装插件（3 分钟搞定）

> 适合大多数使用者的安装步骤

### 第 1 步：下载安装包

1. 打开本项目的 **[Releases 发布页](../../releases)**（GitHub 页面右侧或顶部菜单可找到）
2. 下载最新版的 **`web-translate-xxx.zip`** 安装包

### 第 2 步：解压

把 zip 文件解压到任意位置，例如：

```
下载/web-translate/
```

解压后你会看到一个文件夹（里面包含 `manifest.json` 等文件）。**记住这个文件夹的位置**，后面要用。

> 提示：不要只打开 zip 不解压，Chrome 无法直接加载压缩包。

### 第 3 步：加载到 Chrome

1. 打开 Chrome，地址栏输入 **`chrome://extensions/`** 回车
2. 打开右上角的 **「开发者模式」**
3. 点击 **「加载已解压的扩展程序」**
4. 选中刚才解压出来的那个文件夹
5. 完成！工具栏会出现 Web Translate 图标

**Edge 用户：** 打开 **`edge://extensions/`**，其余步骤相同。

### 第 4 步：固定到工具栏（推荐）

如果没看到图标，点浏览器右上角的 **拼图图标** → 找到 **Web Translate** → 点 **图钉** 固定。

---

## 登录并开始使用

### 登录

1. 点击工具栏上的 Web Translate 图标
2. 输入在 [la-yee.com](https://la-yee.com) 注册的邮箱和密码
3. 点击 **登录**

登录成功后，顶部会显示 **「已连接」**，就可以开始翻译了。

### 翻译文字

**方法一：点按钮**

1. 在任意网页上 **选中一段文字**
2. 点击选区旁边出现的 **「翻译」** 按钮
3. 译文会出现在旁边的浮层里

**方法二：快捷键**

1. 选中文字
2. 按 **`Alt + T`**（Mac 上是 **`Option + T`**）

### 切换目标语言

点击插件图标，在弹窗里选择你想翻译成的语言（默认中文）。

### 关闭翻译窗口

按键盘 **`Esc`**，或点击页面其他位置。

---

## 常见问题

**选中了文字，但没有出现「翻译」按钮？**

- 刷新一下当前网页再试
- 部分页面（如 Chrome 设置页、应用商店）不支持插件运行，这是浏览器限制

**插件显示「未连接」？**

- 检查网络是否正常
- 退出登录后重新登录
- 仍不行请到 [la-yee.com](https://la-yee.com) 查看服务状态或联系支持

**快捷键没反应？**

- 先选中文字，再按快捷键
- 打开 `chrome://extensions/shortcuts`，看看有没有和其他插件冲突

**怎么更新插件？**

1. 下载新版本安装包并解压（可以覆盖旧文件夹，或解压到新位置）
2. 打开 `chrome://extensions/`
3. 找到 Web Translate，点 **刷新** 按钮

---

## 隐私说明

- 只有在你 **主动选中文字并点击翻译** 时，才会把这段文字发送到服务器
- 登录信息只保存在你的浏览器本地，不会写入网页

---

<br>

---

# 开发者指南

> 以下内容面向希望阅读源码、自行构建或参与贡献的开发者。

## 从源码构建

### 环境要求

- Node.js 18+
- npm 9+

### 构建步骤

```bash
git clone <your-repo-url>
cd web-translate-extension
npm install
npm run build
```

构建完成后，产物在 **`dist/`** 目录。在 `chrome://extensions/` 中加载 **`dist/`** 文件夹即可。

```bash
npm run watch      # 开发时自动重建
npm run typecheck  # 类型检查
```

## 项目结构

```
extension/
├── manifest.json       # 扩展清单
├── src/
│   ├── background/     # 后台：连接服务器、消息处理
│   ├── content/        # 页面脚本：选词、翻译浮层
│   ├── popup/          # 弹窗：登录、设置
│   └── shared/         # 共享配置与类型
├── scripts/            # 构建脚本
└── dist/               # 构建产物（需本地 build 生成）
```

## 服务器配置

插件需要连接 Web Translate 后端才能翻译。

| 场景 | 服务器地址 |
|------|-----------|
| 本地开发 | `http://localhost:8080` |
| La-yee 官方服务 | 见 [la-yee.com](https://la-yee.com) |
| 自托管 | `https://你的域名`（远程必须 HTTPS） |

生产环境可在 `src/shared/config.ts` 中设置 `ALLOWED_SERVER_HOSTS` 域名白名单，修改后重新 build。

## 发布安装包

在 GitHub Release 中附带 `web-translate-vX.X.X.zip`（内容为 `dist/` 目录），供普通用户直接解压安装。建议通过 CI 从 tag 自动构建，保证与源码一致。

## 参与贡献

1. Fork 本仓库
2. 创建功能分支
3. 运行 `npm run typecheck` 确保通过
4. 提交 Pull Request

## 开源协议

本项目采用 [MIT License](LICENSE)（版权方：la-yee）。可自由使用、修改和商用，保留版权声明即可。

---

<p align="center">
  <a href="https://la-yee.com">la-yee.com</a>
</p>
