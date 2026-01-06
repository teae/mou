##部署教程
1. 准备工作    
Telegram Bot Token：在 TG 上找 @BotFather 创建机器人获取。    
Admin UID：在 TG 上找 @userinfobot 获取你自己的 User ID。    
Secret：生成一个随机字符串（用于 Webhook 验证，可用下划线，不能用@#$等特殊字符）。

3. 配置 Cloudflare Workers    
登录 Cloudflare Dashboard。    
进入 Workers & Pages -> Create Application -> Create Worker。    
命名为 tg-bot (或其它名字)，点击 Deploy。

4. 配置 KV 数据库    
在 Workers 页面，点击左侧菜单的 KV。
点击 Create a Namespace，命名为 TG_BOT_KV (或者其他名字)。    
回到你刚才创建的 Worker，进入 Settings -> Variables。    
向下滚动到 KV Namespace Bindings。    
点击 Add binding：      
  Variable name: 必须填 nfd (代码中写死了这个名字)。     
   KV Namespace: 选择刚才创建的 TG_BOT_KV。    
点击 Save and deploy。

4. 设置环境变量
在 Worker 的 Settings -> Variables -> Environment Variables 中添加以下变量：
变量名             说明                      示例
ENV_BOT_TOKEN     你的 Bot Token            123456:ABC-DEF...
ENV_BOT_SECRET    Webhook 密钥 (随机字符串)  random_string_123
ENV_ADMIN_UID     管理员的 User ID          123456789

5. 部署代码    
点击 Edit code 进入在线编辑器。    
项目地址：https://github.com/teae/serverbak/tree/master/tg
将本项目tgbot-workers.js文件的内容完整复制粘贴进去。    
点击右上角的 Deploy。

6. 绑定 Webhook
部署完成后，在浏览器访问以下 URL 来激活机器人：
https://你的worker域名.workers.dev/registerWebhook
如果看到 Ok（整页只显示OK），说明部署成功！
如有其它报错，根据提示排除。
其它

##指令说明 (管理员专用)

所有指令建议直接回复 (Reply) 用户转发过来的消息使用，机器人会自动提取目标用户 ID。
指令         作用                    示例
回复消息     直接回复内容给用户       (直接打字发送)
/block      拉黑该用户 (永久)        回复某条消息发送 /block
/unblock    解封该用户               回复某条消息发送 /unblock
/clear_ver  重置验证 (强制重新验证)   回复某条消息发送 /clear_ver

也可以手动指定 ID，例如 /unblock 123456789，但回复消息更方便且不易出错。

验证机制说明
验证有效期：默认 30 天。用户通过验证后，30 天内无需再次验证。
黑名单：永久有效，除非管理员手动解封。
注意事项
请确保 KV Namespace 的变量名绑定为 nfd，否则机器人无法记忆状态。
Cloudflare KV 存在短暂的最终一致性延迟（约 1 分钟）。如果你刚解封用户，可能需要等几十秒才会生效。
