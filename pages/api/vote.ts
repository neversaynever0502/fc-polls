import type { NextApiRequest, NextApiResponse } from 'next';
import {Poll} from "@/app/types";
import {kv} from "@vercel/kv";
import {getSSLHubRpcClient, Message} from "@farcaster/hub-nodejs";

const HUB_URL = process.env['HUB_URL'] || "nemes.farcaster.xyz:2283"
const client = getSSLHubRpcClient(HUB_URL);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method === 'POST') {
        // Process the vote
        // For example, let's assume you receive an option in the body
        try {
            const pollId = req.query['id']
            const results = req.query['results'] === 'true'
            let voted = req.query['voted'] === 'true'
            if (!pollId) {
                return res.status(400).send('Missing poll ID');
            }

            let validatedMessage : Message | undefined = undefined;
            try {

                kv.set('test_data_req_body', JSON.stringify(req.body))
                const frameMessage = Message.decode(Buffer.from(req.body?.trustedData?.messageBytes || '', 'hex'));
                const result = await client.validateMessage(frameMessage);
                if (result.isOk() && result.value.valid) {
                    validatedMessage = result.value.message;
                }

                // Also validate the frame url matches the expected url
                let urlBuffer = validatedMessage?.data?.frameActionBody?.url || [];
                const urlString = Buffer.from(urlBuffer).toString('utf-8');
                if (!urlString.startsWith(process.env['HOST'] || '')) {
                    return res.status(400).send(`Invalid frame url: ${urlBuffer}`);
                }
            } catch (e)  {
                return res.status(400).send(`Failed to validate message: ${e}`);
            }

            const buttonId = validatedMessage?.data?.frameActionBody?.buttonIndex || 0;
            const fid = validatedMessage?.data?.fid || 0;
            // await fetch('https://')
            // kv.set('poll_data_details',JSON.stringify(JSON.parse(validatedMessage?.data?.toString())))
            // 將 Buffer 轉換為字符串
            // 假設 validatedMessage?.data 是已解析的 req.body 中的 data 對象
            const data = validatedMessage?.data
            const userDataBody = validatedMessage?.data?.userDataBody
            await kv.set('userDataBody', userDataBody);


            // 函數來處理並轉換 Buffer 對象
            const processBuffer=(obj: any)=> {
                for (const key in obj) {
                    if (obj[key] && typeof obj[key] === 'object') {
                        if (obj[key].type === 'Buffer' && Array.isArray(obj[key].data)) {
                            // 將 Buffer 轉換為 UTF-8 字符串（或者根據你的需求轉換為其他格式）
                            obj[key] = Buffer.from(obj[key].data).toString('utf-8');
                        } else {
                            // 遞歸處理嵌套對象
                            processBuffer(obj[key]);
                        }
                    }
                }
            }

            // 檢查 data 是否存在並處理它
            if (data) {
                processBuffer(data); // 處理 data 對象中的所有 Buffer
            
                // 提取 frameActionBody 中的 castId 的 hash
                const castIdHashData = data.frameActionBody?.castId?.hash;
                if (castIdHashData) {
                    // 將數字數組轉換成 Buffer，然後轉換為十六進制字符串
                    // const hashHexString = Buffer.from(castIdHashData).toString('hex');
                    const hashHexString = Buffer.from(castIdHashData).toString('hex')
            
                    // 將 hashHexString 存儲到 Redis
                    await kv.set('castId', hashHexString);
                }
            
                // 將處理後的對象轉換為 JSON 字符串並存儲
                await kv.set('poll_data_details', JSON.stringify(data));
            } else {
                // 處理 data 為 undefined 的情況
                await kv.set('poll_data_details', '{}');
            }
            // let testVar = validatedMessage?.data || ''
            // if(testVar!==undefined) {
                // let poll_data_details_dataStr_buffer = Buffer.from(testVar).toString('utf-8');
            // let urlBuffer = validatedMessage?.data || [];
            // const urlString = Buffer.from(urlBuffer).toString('utf-8');

            // }

            // Use untrusted data for testing
            // const buttonId = req.body?.untrustedData?.buttonIndex || 0;
            // const fid = req.body?.untrustedData?.fid || 0;

            // Clicked create poll
            if ((results || voted) && buttonId === 2) {
                return res.status(302).setHeader('Location', `${process.env['HOST']}`).send('Redirecting to create poll');
            }


            const voteExists = await kv.sismember(`poll:${pollId}:voted`, fid)
            voted = voted || !!voteExists

            if (fid > 0 && buttonId > 0 && buttonId < 5 && !results && !voted) {
                let multi = kv.multi();
                multi.hincrby(`poll:${pollId}`, `votes${buttonId}`, 1);
                multi.sadd(`poll:${pollId}:voted`, fid);
                await multi.exec();
            }

            let poll: Poll | null = await kv.hgetall(`poll:${pollId}`);

            if (!poll) {
                return res.status(400).send('Missing poll ID');
            }
            const imageUrl = `${process.env['HOST']}/api/image?id=${poll.id}&results=${results ? 'false': 'true'}&date=${Date.now()}${ fid > 0 ? `&fid=${fid}` : '' }`;
            let button1Text = "View Results";
            if (!voted && !results) {
                button1Text = "Back"
            } else if (voted && !results) {
                button1Text = "Already Voted"
            } else if (voted && results) {
                button1Text = "View Results"
            }

            // Return an HTML response
            res.setHeader('Content-Type', 'text/html');
            res.status(200).send(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Vote Recorded</title>
          <meta property="og:title" content="Vote Recorded">
          <meta property="og:image" content="${imageUrl}">
          <meta name="fc:frame" content="vNext">
          <meta name="fc:frame:image" content="${imageUrl}">
          <meta name="fc:frame:post_url" content="${process.env['HOST']}/api/vote?id=${poll.id}&voted=true&results=${results ? 'false' : 'true'}">
          <meta name="fc:frame:button:1" content="${button1Text}">
          <meta name="fc:frame:button:2" content="Create your poll">
          <meta name="fc:frame:button:2:action" content="post_redirect">
        </head>
        <body>
          <p>${ results || voted ? `You have already voted. You clicked ${buttonId}` : `Your vote for ${buttonId} has been recorded for fid ${fid}.` }</p>
        </body>
      </html>
    `);
        } catch (error) {
            console.error(error);
            res.status(500).send('Error generating image');
        }
    } else {
        // Handle any non-POST requests
        res.setHeader('Allow', ['POST']);
        res.status(405).end(`Method ${req.method} Not Allowed`);
    }
}
