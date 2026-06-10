# AI智能图片编辑器

一个面向电商卖家的 AI 商品图片生成工具，支持 C 端注册登录、B 端为用户配置图片/视频模型 Key、商品详情页套图、单图生成、二次编辑、本地素材管理，以及配套 B 端用户和生成日志管理。

## 启动

```bash
python3 server.py
```

打开 C 端：

```text
http://localhost:8787
```

打开 B 端：

```text
http://localhost:8787/admin-login.html
```

已登录管理员也可以直接打开 `http://localhost:8787/admin.html`，未登录或登录过期会自动跳回登录页。

默认 B 端账号：

```text
admin@example.com / change-me
```

生产部署时请设置：

```bash
ADMIN_EMAIL="你的管理员邮箱"
ADMIN_PASSWORD="强密码"
SESSION_DAYS=14
```

## 产品形态

- C 端用户必须注册 / 登录后才能生成图片；图片 Key、图片地址、视频 Key 和视频地址由 B 端为每个用户配置。
- 默认注册用户都是普通用户，只能使用 C 端；只有内置 B 端管理员或被后台授予管理员角色的注册用户可以登录 B 端。
- C 端只显示脱敏后的 Key 状态；图片地址可由 B 端按用户配置，未配置时使用 B 端默认地址和模型。
- 工具不提供套餐、充值或配额扣减。
- 后端保存用户信息、会话、模型配置、生成调用日志和用量统计。
- B 端登录页独立于管理台；登录后可以查看所有注册用户、设置用户角色、配置/清空用户图片 Key、图片地址、视频 Key 和视频地址、禁用/启用用户、查看图片反馈、查看所有生成记录的入参/出参日志、查看调用次数和 token 数，并配置默认模型与提示词。

## 默认模型

默认接口：

```bash
https://aokapi.com/v1beta/models/gemini-2.5-flash-image:generateContent/
```

默认模型：

```bash
gemini-2.5-flash-image
```

上传参考图后，工具会按 AOKAPI NanoBanana / Gemini 图生图格式发送：提示词放在 `contents[0].parts[].text`，参考图放在 `contents[0].parts[].inlineData`，返回图片从 `candidates[].content.parts[].inlineData.data` 解析。若切回旧版 `images/generations` 接口，工具仍保留旧字段探测逻辑作为兼容兜底。

## B 端能力

- 查看所有用户姓名、邮箱、注册时间、最近登录时间和图片/视频 Key 脱敏配置状态
- 为每个注册用户配置或清空图片 Key、图片地址、视频 Key 和两个视频地址
- 查看每个用户调用次数、生成图片数、输入 token、输出 token、总 token
- 禁用或启用用户；禁用后用户会话失效，前端生成前会被拦截
- 查看最近生成记录，包括用户、模型、状态、耗时、token 和脱敏后的请求/响应 JSON
- 配置默认接口地址、默认模型和用量说明

## Docker

```bash
docker build -t image-editor-tool .
docker run -p 8787:8787 -e ADMIN_EMAIL=admin@example.com -e ADMIN_PASSWORD=change-me image-editor-tool
```

## 数据存储

- SQLite 数据库默认在 `storage/image_studio.sqlite`
- C 端本地素材库仍使用浏览器 IndexedDB
- 用户图片/视频 Key 只保存在后端 SQLite，不通过 C 端接口返回明文
- 生成日志会截断图片 base64 和超大字段，不记录用户图片/视频 Key

## 功能

- 图片上传和本地预览
- 上传参考图删除
- 上传后识别原图尺寸并作为默认生成尺寸
- 一键生成 Amazon 详情页套图
- 一键生成商城连贯详情长图
- 一键生成品牌广告套图
- 套图图位可删除，每张套图可独立调整输出尺寸
- 提示词输入
- 通用商品图提示词模板
- 用户自定义提示词模板本地保存
- 生成张数与尺寸设置
- 所有图片生成请求自动附加商品主体 1:1 还原原图的强约束
- 上传参考图会参与单图、套图和二次编辑请求，提高商品主体一致性
- 配置弹窗可测试入参图片是否生效，并展示带图结果与无图对照
- 生成图保存到本地素材库
- 生成结果可单张删除、保存或继续二次编辑
- 历史文件夹选择或新建文件夹
- 默认时间戳命名，可改图片名称
- 生成图二次编辑与再次保存
- 素材库文件夹和文件快速搜索
- AI 视频入口预留
