import { convertToOutbounds } from './singbox-converter.js';

export default async function handler(req, res) {
  // 设置 CORS 跨域响应头，允许你的博客前端安全调用
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed, use POST' });
  }

  try {
    const { sub_url } = req.body;
    if (!sub_url) {
      return res.status(400).json({ error: 'Missing sub_url parameter' });
    }

    // 1. 在服务端用 fetch 获取机场的订阅内容（完美绕过浏览器跨域）
    const subRes = await fetch(sub_url, {
      headers: {
        'User-Agent': 'mihomo'
      }
    });

    if (!subRes.ok) {
      throw new Error(`Failed to fetch subscription, status: ${subRes.status}`);
    }

    const rawSubscriptionText = await subRes.text();

    // 2. 调用你提供的 singbox-converter.js 中的核心函数，将订阅文本转换为 sing-box 的 outbounds 数组
    const parsedOutbounds = await convertToOutbounds(rawSubscriptionText, {
      globalAllowInsecure: true // 允许跳过证书验证，适应部分机场
    });

    // 3. 定义一个标准的 sing-box 基础配置模板（DNS、路由分流、策略组等）
    const singBoxConfig = {
      log: {
        level: "info",
        timestamp: true
      },
      dns: {
        servers: [
          { tag: "dns_remote", address: "https://1.1.1.1/dns-query", detour: "select" },
          { tag: "dns_direct", address: "https://223.5.5.5/dns-query", detour: "direct" }
        ],
        rules: [
          { outbound: "any", server: "dns_remote" },
          { clashing_mode: "direct", server: "dns_direct" }
        ]
      },
      inbounds: [
        { type: "mixed", tag: "mixed-in", listen: "127.0.0.1", listen_port: 2080 }
      ],
      outbounds: [
        {
          type: "selector",
          tag: "select",
          outbounds: ["auto", ...parsedOutbounds.map(o => o.tag)],
          default: "auto"
        },
        {
          type: "urltest",
          tag: "auto",
          outbounds: parsedOutbounds.map(o => o.tag),
          url: "https://www.gstatic.com/generate_204",
          interval: "3m"
        },
        ...parsedOutbounds, // 将解析出来的所有节点自动追加到出站列表中
        { type: "direct", tag: "direct" },
        { type: "block", tag: "block" }
      ],
      route: {
        rules: [
          { protocol: "dns", action: "hijack-dns" },
          { ip_is_private: true, outbound: "direct" }
        ],
        auto_detect_interface: true
      }
    };

    // 4. 将组装好的完整配置以 JSON 格式返回给前端
    return res.status(200).json(singBoxConfig);

  } catch (err) {
    return res.status(500).json({ 
      error: 'Conversion failed', 
      message: err.message 
    });
  }
}
