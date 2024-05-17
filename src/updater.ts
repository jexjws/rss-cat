//代码罗辑
import { Context, Logger, Schema, Session, Time, h, $ } from 'koishi'
import { concatMap, map, of, switchMap, throwError, pipe, filter, mergeMap, catchError, EMPTY, Subject } from 'rxjs'
import { Config, RssSource, logger } from '.'
var FeedParser = require('feedparser');




const UpdateSubOperator = (ctx: Context, config: Config) => {
    return pipe(
        mergeMap(async (RssSource: RssSource) => {
            logger.debug(`拉取: ${JSON.stringify(RssSource)}`)
            const { data, headers } = await ctx.http(RssSource.rssLink, { responseType: 'text', headers: { 'user-agent': config.userAgent } })

            return { httpRes: { data, headers }, RssSource }
        }),
        catchError((err, caught) => {
            logger.warn(`拉取失败: ${err.message}`)
            return EMPTY //TODO:向上游文档 https://rxjs.dev/api/index/function/catchError 添加返回空Observable以阻止出错的Observable进入后续流水线的示例
        }),
        mergeMap(async ({ httpRes, RssSource }) => {
            const feedItems = await getStreamItems(httpRes.data); //先把Rss里面的items取出来
            const newItems = feedItems.filter((item: { pubDate: string | number | Date; }) => {
                const itemDate = new Date(item.pubDate);
                return itemDate > RssSource.lastBroadcastedpubDate;
            });//把日期早于 lastBroadcastedpubDate 的 item 过滤掉

            //剩下的就是新的，还没广播出去的item
            if (newItems.length > 0) {

                for (const item of newItems) {
                    const message = `Title: ${item.title}\nLink: ${item.link}`;
                    await (ctx as any).broadcast(RssSource.subscriber, message);
                }
                const latestDate = new Date(Math.max(...newItems.map((item: { pubDate: string | number | Date; }) => new Date(item.pubDate).getTime())));
                await ctx.database.set('rsscat.source', RssSource.id, {
                    lastBroadcastedpubDate: latestDate,
                });
            }

            return RssSource;
        })

    )
}
// feedparser-helper.js
const getStreamItems: (data: string) => Promise<any[]> = async (data: string) => {
    return new Promise((resolve, reject) => {
        const feedparser = new FeedParser();
        const items = [];

        feedparser.on('error', reject);
        feedparser.on('readable', function () {
            let item: any;
            while (item = this.read()) {
                items.push(item);
            }
        });
        feedparser.on('end', () => resolve(items));

        feedparser.end(data);
    });
};
export { UpdateSubOperator }