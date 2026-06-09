# AI智能图片编辑器

一个面向电商卖家的 AI 商品图片生成、整套详情页套图生成、二次编辑与素材管理原型。

## 使用方式

直接用浏览器打开 `index.html`。页面会把 API Key、接口地址、模型名保存到本地浏览器，素材库使用 IndexedDB 本地存储。

默认接口：

```bash
https://aokapi.com/v1beta/models/gemini-2.5-flash-image:generateContent/
```

默认请求体：

```json
{
  "contents": [
    {
      "role": "user",
      "parts": [
        {
          "text": "你的提示词"
        },
        {
          "inlineData": {
            "data": "BASE64_IMG",
            "mimeType": "image/png"
          }
        }
      ]
    }
  ],
  "generationConfig": {
    "responseModalities": ["TEXT", "IMAGE"],
    "imageConfig": {
      "aspectRatio": "1:1",
      "imageSize": "1K"
    }
  }
}
```

上传参考图后，工具会按 AOKAPI NanoBanana / Gemini 图生图格式发送：提示词放在 `contents[0].parts[].text`，参考图放在 `contents[0].parts[].inlineData`，返回图片从 `candidates[].content.parts[].inlineData.data` 解析。若切回旧版 `images/generations` 接口，工具仍保留旧字段探测逻辑作为兼容兜底。

## 云端 SaaS 模式

现在也可以启动后端，把这个工具部署给多人使用：

```bash
cd image-editor-tool
python3 server.py
```

打开：

```text
http://localhost:8787
```

生产部署时设置环境变量：

```bash
IMAGE_API_KEY="你的模型 API Key"
IMAGE_API_ENDPOINT="https://aokapi.com/v1beta/models/gemini-2.5-flash-image:generateContent/"
IMAGE_API_MODEL="gemini-2.5-flash-image"
IMAGE_STUDIO_STORAGE="/data/image-studio"
IMAGE_STUDIO_DB="/data/image-studio/image_studio.sqlite"
CORS_ORIGIN="https://你的域名"
PORT=8787
```

Docker：

```bash
docker build -t image-editor-tool .
docker run -p 8787:8787 --env-file .env -v "$PWD/storage:/data/image-studio" image-editor-tool
```

云端模式包含：

- 多用户注册、登录、退出登录
- 服务端 Session Token
- SQLite 数据库
- 服务端保存模型 API Key，前端不暴露供应商密钥
- 云端素材库和文件夹
- 生成记录
- 生成配额扣减
- 配额套餐和 mock 计费订单
- 本地文件对象存储，路径在 `storage/media`

如果没有设置 `IMAGE_API_KEY`，后端会返回 mock 图片，方便测试账号、素材库、生成记录和配额流程。正式部署必须配置 `IMAGE_API_KEY`。

## 数据库表

后端会自动创建 SQLite 表：

- `users`：账号、密码哈希、套餐、剩余配额
- `sessions`：登录 token
- `folders`：用户素材文件夹
- `assets`：云端素材
- `generations`：生成任务记录
- `generation_images`：生成结果图片
- `quota_ledger`：配额流水
- `plans`：可购买套餐
- `billing_orders`：计费订单

真实支付接入点在 `POST /api/billing/checkout` 和支付成功后的订单授信逻辑；当前默认 `MOCK_BILLING_AUTOGRANT=1`，购买套餐会立即增加配额。

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
- API Key、接口地址、模型名后台保存
- 生成图保存到素材库
- 生成结果可单张删除、保存或继续二次编辑
- 历史文件夹选择或新建文件夹
- 默认时间戳命名，可改图片名称
- 生成图二次编辑与再次保存
- 素材库文件夹和文件快速搜索
- 云端账号体系
- 云端素材库
- 生成记录
- 配额扣减和套餐充值

## 说明

当前二次编辑基于 AOKAPI Gemini 图生图 JSON 接口实现：它会把当前基图转成 `inlineData`，再把上一版提示词和本次微调要求组合后提交给 `generateContent`。这已经是图生图路径，不再只是提示词复刻。
