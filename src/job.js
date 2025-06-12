import { config } from './config.js';
import { database } from './database.js';

// 常量定义
const API_CONFIG = {
  BASE_URL: config.api.baseUrl,
  DEFAULT_CSRF: config.api.defaultCsrf,
  PAGE_SIZE: config.api.pageSize,
  MAX_PAGES: config.api.maxPages,
  BATCH_SIZE: config.api.batchSize,
  DB_BATCH_SIZE: config.api.dbBatchSize,
  BATCH_DELAY: config.api.batchDelay
};

const SQL_STATEMENTS = {
  INSERT_ORDER: `
    INSERT OR REPLACE INTO orders (
      biz_order_id, parent_order_id, seller_nick, item_id, item_title,
      ad_user_nick, agency_nick, order_status, order_paid_time,
      order_amount, order_commission_amount, predict_amount,
      seller_commission_ratio, remark, refund_amount, predict_total_amount,
      out_ad_user_name, out_ad_user_fee, out_ad_user_ratio, out_ad_user_type,
      rid, end_time, picture, refund_end_time, partner_ratio,
      partner_predict_amount, modify_time, extend_info, buy_amount,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
  INSERT_SYNC_LOG: `
    INSERT INTO sync_logs (
      anchor_id, anchor_name, sync_status, reason, order_count, sync_time, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `,
  UPSERT_REPORT: `
    INSERT OR REPLACE INTO reports (
      anchor_id, anchor_name, report_date, order_count, order_amount, commission,
      buy_count, refund_count, refund_amount, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `
};

// Node.js 定时任务函数
export async function runScheduledJob() {
  console.log('开始执行定时任务...');
  await fetchAndSaveOrders();
}

// 手动触发任务
export async function triggerJob() {
  console.log('手动触发任务...');
  await fetchAndSaveOrders();
  return { success: true, message: '任务执行完成' };
}

// 单个主播同步
export async function syncSingleAnchor(requestData) {
  return await handleSingleAnchorSync(requestData);
}

/**
 * 获取并保存订单数据 - 多主播并行版本
 */
async function fetchAndSaveOrders() {
  try {
    console.log('开始执行多主播订单同步任务...');

    const activeAnchors = await getActiveAnchors();
    if (!activeAnchors || activeAnchors.length === 0) {
      console.log('没有找到活跃的主播，任务结束');
      return;
    }

    console.log(`找到 ${activeAnchors.length} 个活跃主播，开始并行同步...`);


    const results = [];
    for (let i = 0; i < activeAnchors.length; i += API_CONFIG.BATCH_SIZE) {
      const batch = activeAnchors.slice(i, i + API_CONFIG.BATCH_SIZE);
      console.log(`处理第 ${Math.floor(i / API_CONFIG.BATCH_SIZE) + 1} 批主播 (${batch.length} 个)`);

      const batchPromises = batch.map(anchor => processAnchorOrders(anchor));
      const batchResults = await Promise.allSettled(batchPromises);
      results.push(...batchResults);

      if (i + API_CONFIG.BATCH_SIZE < activeAnchors.length) {
        await sleep(API_CONFIG.BATCH_DELAY);
      }
    }

    const summary = summarizeResults(results, activeAnchors);
    console.log(`=== 同步完成: 成功${summary.successful}个, 失败${summary.failed}个, 总订单${summary.totalOrders}条, 保存${summary.totalSaved}条 ===`);

    // 在所有主播同步完成后，生成报表统计
    if (summary.successful > 0) {
      console.log('开始生成报表统计...');
      try {
        // 计算同步时间范围
        const timeRange = calculateTimeRange(null, null);
        await generateReportsForAllAnchors(timeRange.startTime, timeRange.endTime);
        console.log('报表统计生成完成');

        // 异步发送钉钉通知
        try {
          console.log('开始发送钉钉佣金统计通知...');
          await sendDingTalkCommissionNotification();
          console.log('钉钉佣金统计通知发送完成');
        } catch (dingError) {
          console.error('发送钉钉通知失败:', dingError);
        }
      } catch (reportError) {
        console.error('生成报表统计失败:', reportError);
      }
    }

  } catch (error) {
    console.error('多主播定时任务执行失败:', error);
  }
}

/**
 * 处理单个主播同步请求
 */
async function handleSingleAnchorSync(requestData) {
  try {
    const { anchorId, startTime, endTime } = requestData;

    // 验证必填参数
    if (!anchorId) {
      return {
        success: false,
        error: '主播ID为必填参数'
      };
    }

    // 从数据库获取主播信息
    const anchor = await getAnchorById(anchorId);
    if (!anchor) {
      return {
        success: false,
        error: '主播不存在或已被删除'
      };
    }

    // 智能计算时间范围
    const timeRange = calculateTimeRange(startTime, endTime);

    console.log(`开始单个主播同步: ${anchor.anchor_name} (${anchorId})`);
    console.log(`计算后的时间范围: ${timeRange.startTime} 到 ${timeRange.endTime}`);

    // 执行单个主播同步
    const result = await syncSingleAnchorWithTimeRangeOptimized(anchor, timeRange.startTime, timeRange.endTime);

    return {
      success: true,
      message: '主播数据同步完成',
      data: result
    };

  } catch (error) {
    console.error('单个主播同步失败:', error);
    console.error('错误堆栈:', error.stack);

    return {
      success: false,
      error: '同步失败: ' + error.message,
      details: error.stack,
      timestamp: new Date().toISOString()
    };
  }
}

/**
 * 智能计算时间范围
 */
function calculateTimeRange(providedStartTime, providedEndTime) {
  // 如果提供了完整的时间参数，进行格式验证
  if (providedStartTime && providedEndTime) {
    const timeRegex = /^\d{8} \d{2}:\d{2}:\d{2}$/;
    if (!timeRegex.test(providedStartTime) || !timeRegex.test(providedEndTime)) {
      throw new Error('时间格式错误，请使用格式：YYYYMMDD HH:mm:ss，例如：20250120 00:00:00');
    }
    return {
      startTime: providedStartTime,
      endTime: providedEndTime
    };
  }

  // 计算当前时间
  const currentTime = new Date();
  const endTime = new Date(currentTime.getFullYear(), currentTime.getMonth(), currentTime.getDate(), 23, 59, 59);
  const endTimeStr = formatDateTime(endTime);

  // 计算上个月的开始时间（1号 00:00:00）
  const prevMonth = new Date(currentTime.getFullYear(), currentTime.getMonth() - 1, 1, 0, 0, 0);
  const startTime = formatDateTime(prevMonth);
  console.log(`使用上个月1号作为开始时间: ${startTime}`);

  return {
    startTime: startTime,
    endTime: endTimeStr
  };
}

/**
 * 根据ID获取主播信息
 */
async function getAnchorById(anchorId) {
  try {
    const result = await database.all(
      "SELECT id, anchor_name, anchor_id, anchor_cookie, status FROM anchors WHERE anchor_id = ? LIMIT 1",
      [anchorId]
    );

    return result.results && result.results.length > 0 ? result.results[0] : null;
  } catch (error) {
    console.error('获取主播信息失败:', error);
    return null;
  }
}

/**
 * 同步单个主播指定时间范围的数据 - 优化版本，支持错误处理和报表统计
 */
async function syncSingleAnchorWithTimeRangeOptimized(anchor, startTime, endTime) {
  const syncStartTime = Date.now();
  console.log(`[${anchor.anchor_name}] 开始同步时间范围: ${startTime} 到 ${endTime}`);

  try {
    let currentPage = 1;
    let totalProcessed = 0;
    let totalFetched = 0;
    let hasMoreData = true;
    let lastError = null;

    while (hasMoreData) {
      console.log(`[${anchor.anchor_name}] 获取第 ${currentPage} 页数据...`);

      const result = await fetchOrderPage(anchor, currentPage, startTime, endTime, true);

      if (result.success && result.orders.length > 0) {
        totalFetched += result.orders.length;

        // 保存订单数据到数据库
        const savedCount = await saveOrdersToDBOptimized(result.orders);
        totalProcessed += savedCount;

        console.log(`[${anchor.anchor_name}] 第 ${currentPage} 页: 获取 ${result.orders.length} 条，保存 ${savedCount} 条`);

        // 检查是否还有更多数据
        hasMoreData = result.orders.length === API_CONFIG.PAGE_SIZE && result.totalCount > currentPage * API_CONFIG.PAGE_SIZE;
        currentPage++;

        // 添加延迟避免请求过快
        await sleep(500);
      } else {
        // 检查是否是API错误
        if (result.error) {
          lastError = result.error;
          console.error(`[${anchor.anchor_name}] 第 ${currentPage} 页API错误: ${result.error}`);
          console.error(`[${anchor.anchor_name}] 遇到错误，终止同步`);
          break;
        } else {
          console.log(`[${anchor.anchor_name}] 第 ${currentPage} 页无数据`);
        }
        hasMoreData = false;
      }

      // 安全限制：最多处理指定页数
      if (currentPage > API_CONFIG.MAX_PAGES) {
        console.log(`[${anchor.anchor_name}] 已达到最大页数限制`);
        break;
      }
    }

    const duration = Date.now() - syncStartTime;

    // 如果有错误就记录为失败，没错误就记录为成功
    if (lastError) {
      console.error(`[${anchor.anchor_name}] 同步失败，错误: ${lastError}`);

      await createSyncLog(
        anchor.anchor_id,
        anchor.anchor_name,
        '失败',
        `同步失败: ${lastError}，耗时 ${duration}ms，获取 ${totalFetched} 条，保存 ${totalProcessed} 条，时间范围: ${startTime} 到 ${endTime}`,
        totalProcessed
      );

      return {
        anchor: anchor.anchor_name,
        anchorId: anchor.anchor_id,
        success: false,
        error: lastError,
        totalFetched,
        totalSaved: totalProcessed,
        duration: `${duration}ms`,
        timeRange: `${startTime} 到 ${endTime}`,
        pages: currentPage - 1
      };
    } else {
      console.log(`[${anchor.anchor_name}] 同步完成，耗时 ${duration}ms，获取 ${totalFetched} 条，保存 ${totalProcessed} 条`);

      await createSyncLog(
        anchor.anchor_id,
        anchor.anchor_name,
        '成功',
        `同步完成，耗时 ${duration}ms，获取 ${totalFetched} 条，保存 ${totalProcessed} 条，时间范围: ${startTime} 到 ${endTime}`,
        totalProcessed
      );

      // 同步成功后，为该主播生成报表统计
      if (totalProcessed > 0) {
        try {
          console.log(`[${anchor.anchor_name}] 开始生成报表统计...`);
          await generateReportForAnchor(anchor.anchor_id, anchor.anchor_name, startTime, endTime);
          console.log(`[${anchor.anchor_name}] 报表统计生成完成`);
        } catch (reportError) {
          console.error(`[${anchor.anchor_name}] 生成报表统计失败:`, reportError);
        }
      }

      const result = {
        anchor: anchor.anchor_name,
        anchorId: anchor.anchor_id,
        success: true,
        totalFetched,
        totalSaved: totalProcessed,
        duration: `${duration}ms`,
        timeRange: `${startTime} 到 ${endTime}`,
        pages: currentPage - 1
      };

      console.log(`[${anchor.anchor_name}] 同步完成，耗时 ${duration}ms，获取 ${totalFetched} 条，保存 ${totalProcessed} 条`);
      return result;
    }

  } catch (error) {
    const duration = Date.now() - syncStartTime;
    console.error(`[${anchor.anchor_name}] 同步失败:`, error);

    // 创建失败的同步记录
    await createSyncLog(
      anchor.anchor_id,
      anchor.anchor_name,
      '失败',
      `同步失败: ${error.message}，耗时 ${duration}ms，时间范围: ${startTime} 到 ${endTime}`,
      0
    );

    return {
      anchor: anchor.anchor_name,
      anchorId: anchor.anchor_id,
      success: false,
      error: error.message,
      duration: `${duration}ms`,
      timeRange: `${startTime} 到 ${endTime}`
    };
  }
}




/**
 * 获取所有活跃主播
 */
async function getActiveAnchors() {
  try {
    const result = await database.all(
      "SELECT id, anchor_name, anchor_id, anchor_cookie FROM anchors WHERE status = 'active' ORDER BY id"
    );

    return result.results || [];
  } catch (error) {
    console.error('获取活跃主播失败:', error);
    return [];
  }
}

/**
 * 处理单个主播的订单同步
 */
async function processAnchorOrders(anchor) {
  const startTime = Date.now();
  console.log(`开始同步主播: ${anchor.anchor_name} (ID: ${anchor.anchor_id})`);

  try {
    // 智能计算时间范围
    const timeRange = calculateTimeRange(null, null);
    const startTimeStr = timeRange.startTime;
    const endTimeStr = timeRange.endTime;

    console.log(`[${anchor.anchor_name}] 使用时间范围: ${startTimeStr} 到 ${endTimeStr}`);

    let currentPage = 1;
    let totalProcessed = 0;
    let totalFetched = 0;
    let hasMoreData = true;
    let lastError = null; // 记录最后一个错误

    while (hasMoreData) {
      console.log(`[${anchor.anchor_name}] 获取第 ${currentPage} 页数据...`);

      const result = await fetchOrderPage(anchor, currentPage, startTimeStr, endTimeStr);
    //   console.log("响应内容:"+JSON.stringify(result));
  if (result.success && result.orders.length > 0) {
        totalFetched += result.orders.length;

        // 保存订单数据到数据库
        const savedCount = await saveOrdersToDBOptimized(result.orders);
        totalProcessed += savedCount;

        console.log(`[${anchor.anchor_name}] 第 ${currentPage} 页: 获取 ${result.orders.length} 条，保存 ${savedCount} 条`);

        // 检查是否还有更多数据
        hasMoreData = result.orders.length === API_CONFIG.PAGE_SIZE && result.totalCount > currentPage * API_CONFIG.PAGE_SIZE;
        currentPage++;

        // 添加延迟避免请求过快
        // await sleep(500);
      } else {
        // 检查是否是API错误
        if (result.error) {
          lastError = result.error;
          console.error(`[${anchor.anchor_name}] 第 ${currentPage} 页API错误: ${result.error}`);
        //   console.log("报错响应内容:", JSON.stringify(result));
          console.error(`[${anchor.anchor_name}] 遇到错误，终止同步`);
          break;
        } else {
          console.log(`[${anchor.anchor_name}] 第 ${currentPage} 页无数据`);
        }
        hasMoreData = false;
      }

      // 安全限制：最多处理指定页数
      if (currentPage > API_CONFIG.MAX_PAGES) {
        console.log(`[${anchor.anchor_name}] 已达到最大页数限制`);
        break;
      }
    }

    const duration = Date.now() - startTime;

    // 如果有错误就记录为失败，没错误就记录为成功
    if (lastError) {
      console.error(`[${anchor.anchor_name}] 同步失败，错误: ${lastError}`);

      await createSyncLog(
        anchor.anchor_id,
        anchor.anchor_name,
        '失败',
        `同步失败: ${lastError}，耗时 ${duration/1000}秒，获取 ${totalFetched} 条，保存 ${totalProcessed} 条`,
        totalProcessed
      );

      return {
        anchor: anchor.anchor_name,
        success: false,
        error: lastError,
        totalFetched,
        totalSaved: totalProcessed,
        duration
      };
    } else {
      console.log(`[${anchor.anchor_name}] 同步完成，耗时 ${duration/1000}秒，获取 ${totalFetched} 条，保存 ${totalProcessed} 条`);

      await createSyncLog(
        anchor.anchor_id,
        anchor.anchor_name,
        '成功',
        `同步完成，耗时 ${duration/1000}秒，获取 ${totalFetched} 条，保存 ${totalProcessed} 条`,
        totalProcessed
      );

      // 同步成功后，为该主播生成报表统计
      if (totalProcessed > 0) {
        try {
          console.log(`[${anchor.anchor_name}] 开始生成报表统计...`);
          await generateReportForAnchor(anchor.anchor_id, anchor.anchor_name, startTimeStr, endTimeStr);
          console.log(`[${anchor.anchor_name}] 报表统计生成完成`);
        } catch (reportError) {
          console.error(`[${anchor.anchor_name}] 生成报表统计失败:`, reportError);
        }
      }

      return {
        anchor: anchor.anchor_name,
        success: true,
        totalFetched,
        totalSaved: totalProcessed,
        duration
      };
    }

  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`[${anchor.anchor_name}] 同步失败:`, error);

    // 创建失败的同步记录
    await createSyncLog(
      anchor.anchor_id,
      anchor.anchor_name,
      '失败',
      `同步失败: ${error.message}，耗时 ${duration/1000}秒`,
      0
    );

    return {
      anchor: anchor.anchor_name,
      success: false,
      error: error.message,
      duration
    };
  }
}

/**
 * 统计同步结果
 */
function summarizeResults(results, anchors) {
  let successful = 0;
  let failed = 0;
  let totalOrders = 0;
  let totalSaved = 0;

  results.forEach((result, index) => {
    if (result.status === 'fulfilled' && result.value.success) {
      successful++;
      totalOrders += result.value.totalFetched || 0;
      totalSaved += result.value.totalSaved || 0;
    } else {
      failed++;
      console.error(`主播 ${anchors[index]?.anchor_name} 同步失败:`,
        result.reason || result.value?.error);
    }
  });

  return {
    successful,
    failed,
    totalOrders,
    totalSaved
  };
}

/**
 * 统一的订单数据获取函数
 */
async function fetchOrderPage(anchor, pageNo, startTime, endTime, enableDetailedLogging = false) {
  const params = new URLSearchParams({
    '_csrf': config.api.defaultCsrf,
    'dateType': '0',
    'endTime': endTime,
    'orderStatus': '-1',
    'pageNo': pageNo.toString(),
    'pageSize': API_CONFIG.PAGE_SIZE.toString(),
    'startTime': startTime,
    'type': '1'
  });

  const requestUrl = `${API_CONFIG.BASE_URL}?${params.toString()}`;
  const cookieToUse = anchor.anchor_cookie || '';

  const headers = {
    'accept': 'application/json, text/plain, */*',
    'accept-encoding': 'gzip, deflate, br, zstd',
    'accept-language': 'zh-CN,zh;q=0.9',
    'bx-v': '2.5.31',
    'cookie': cookieToUse,
    'priority': 'u=1, i',
    'referer': 'https://hot.taobao.com/hw/union/console/wallet/predict-order',
    'sec-ch-ua': '"Chromium";v="136", "Google Chrome";v="136", "Not.A/Brand";v="99"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-origin',
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
    'x-xsrf-token': config.api.defaultCsrf
  };

  try {
    if (enableDetailedLogging) {
      console.log(`[${anchor.anchor_name}] 请求URL:`, requestUrl);
      console.log(`[${anchor.anchor_name}] 时间范围: ${startTime} 到 ${endTime}`);
    }

    const response = await fetch(requestUrl, { method: 'GET', headers });

    let responseText;
    try {
      responseText = await response.text();
    } catch (textError) {
      return { success: false, orders: [], totalCount: 0, error: '读取响应失败: ' + textError.message };
    }

    if (!response.ok) {
      console.error(`[${anchor.anchor_name}] HTTP错误: ${response.status} ${response.statusText}`);
      return { success: false, orders: [], totalCount: 0, error: `HTTP ${response.status}: ${response.statusText}`, rawResponse: responseText };
    }

    let data;
    try {
      data = JSON.parse(responseText);
    } catch (parseError) {
      if (responseText.trim().startsWith('<')) {
        return { success: false, orders: [], totalCount: 0, error: 'Cookie无效或需要重新登录' };
      }
      return { success: false, orders: [], totalCount: 0, error: 'JSON解析失败: ' + parseError.message };
    }


    if (data.success && data.data && data.data.orderPage) {
      return { success: true, orders: data.data.orderPage.dataList || [], totalCount: data.data.orderPage.totalCount || 0 };
    } else {
      let errorMessage = '未知错误';
      if (data.ret && Array.isArray(data.ret)) {
        errorMessage = data.ret.join(': ');
      } else if (data.msg) {
        errorMessage = data.msg;
      }
      return { success: false, orders: [], totalCount: 0, error: errorMessage };
    }

  } catch (error) {
    console.error(`[${anchor.anchor_name}] 请求失败:`, error);
    return { success: false, orders: [], totalCount: 0, error: error.message, errorType: error.name };
  }
}







/**
 * 优化版本的订单数据保存 - 支持并发和批量处理
 */
async function saveOrdersToDBOptimized(orders) {
  if (!orders || orders.length === 0) return 0;
  let savedCount = 0;

  try {
    const currentTimeString = getCurrentTimeString();
    const batches = [];

    for (let i = 0; i < orders.length; i += API_CONFIG.DB_BATCH_SIZE) {
      batches.push(orders.slice(i, i + API_CONFIG.DB_BATCH_SIZE));
    }

    // 处理每个批次
    for (const batch of batches) {
      const batchPromises = batch.map(order => {
        return database.run(SQL_STATEMENTS.INSERT_ORDER, [
          order.bizOrderId,
          order.parentOrderId,
          order.sellerNick,
          order.itemId,
          order.itemTitle,
          order.adUserNick,
          order.agencyNick,
          order.orderStatus,
          order.orderPaidTime,
          parseFloat(order.orderAmount) || 0,
          parseFloat(order.orderCommissionAmount) || 0,
          parseFloat(order.predictAmount) || 0,
          order.sellerCommissionRatio,
          order.remark,
          order.refundAmount ? parseFloat(order.refundAmount) : null,
          parseFloat(order.predictTotalAmount) || 0,
          order.outAdUserName,
          order.outAdUserFee ? parseFloat(order.outAdUserFee) : null,
          order.outAdUserRatio,
          order.outAdUserType,
          order.rid,
          order.endTime,
          order.picture,
          order.refundEndTime,
          order.partnerRatio,
          order.partnerPredictAmount ? parseFloat(order.partnerPredictAmount) : null,
          order.modifyTime,
          order.extendInfo,
          order.buyAmount || 1,
          currentTimeString,
          currentTimeString
        ]);
      });

      // 执行批量插入
      const results = await Promise.allSettled(batchPromises);
      const batchSavedCount = results.filter(r => r.status === 'fulfilled' && r.value.success).length;
      savedCount += batchSavedCount;

    }

    if (savedCount !== orders.length) {
      console.log(`批量保存完成: ${savedCount}/${orders.length} 条记录`);
    }

  } catch (error) {
    console.error('优化版数据库保存失败:', error);

    console.log('回退到逐条插入模式...');
    savedCount = 0;

    for (const order of orders) {
      try {
        await insertSingleOrderOptimized(order);
        savedCount++;
      } catch (singleError) {
        console.error(`保存订单 ${order.bizOrderId} 失败:`, singleError);
      }
    }
  }

  return savedCount;
}



/**
 * 优化版本的单条订单插入
 */
async function insertSingleOrderOptimized(order) {
  const currentTimeString = getCurrentTimeString();

  return await database.run(SQL_STATEMENTS.INSERT_ORDER, [
    order.bizOrderId,
    order.parentOrderId,
    order.sellerNick,
    order.itemId,
    order.itemTitle,
    order.adUserNick,
    order.agencyNick,
    order.orderStatus,
    order.orderPaidTime,
    parseFloat(order.orderAmount) || 0,
    parseFloat(order.orderCommissionAmount) || 0,
    parseFloat(order.predictAmount) || 0,
    order.sellerCommissionRatio,
    order.remark,
    order.refundAmount ? parseFloat(order.refundAmount) : null,
    parseFloat(order.predictTotalAmount) || 0,
    order.outAdUserName,
    order.outAdUserFee ? parseFloat(order.outAdUserFee) : null,
    order.outAdUserRatio,
    order.outAdUserType,
    order.rid,
    order.endTime,
    order.picture,
    order.refundEndTime,
    order.partnerRatio,
    order.partnerPredictAmount ? parseFloat(order.partnerPredictAmount) : null,
    order.modifyTime,
    order.extendInfo,
    order.buyAmount || 1,
    currentTimeString,
    currentTimeString
  ]);
}



/**
 * 获取当前时间
 */
function getCurrentTime() {
  return new Date();
}

/**
 * 格式化时间 - 统一函数
 */
function formatDateTime(date = null, format = 'api') {
  const currentTime = date || getCurrentTime();
  const year = currentTime.getFullYear();
  const month = String(currentTime.getMonth() + 1).padStart(2, '0');
  const day = String(currentTime.getDate()).padStart(2, '0');
  const hours = String(currentTime.getHours()).padStart(2, '0');
  const minutes = String(currentTime.getMinutes()).padStart(2, '0');
  const seconds = String(currentTime.getSeconds()).padStart(2, '0');

  return format === 'db'
    ? `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`
    : `${year}${month}${day} ${hours}:${minutes}:${seconds}`;
}

/**
 * 获取当前时间字符串 (数据库格式)
 */
function getCurrentTimeString(date = null) {
  return formatDateTime(date, 'db');
}





/**
 * 延迟函数
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 创建同步记录
 */
async function createSyncLog(anchorId, anchorName, syncStatus, reason, orderCount) {
  try {
    const currentTimeString = getCurrentTimeString();

    // 检查reason是否包含NOT_LOGIN，如果包含则更新主播状态为失效
    if (reason && reason.includes('NOT_LOGIN')) {
      try {
        console.log(`[${anchorName}] 检测到NOT_LOGIN错误，将主播状态设置为失效`);

        // 更新主播状态为失效
        await database.run(`
          UPDATE anchors
          SET status = 'invalid', updated_at = ?
          WHERE anchor_id = ?
        `, [currentTimeString, anchorId]);

        console.log(`[${anchorName}] 主播状态已更新为失效`);

        // 异步发送钉钉Cookie失效通知
        try {
          console.log(`[${anchorName}] 开始发送Cookie失效钉钉通知...`);
          await sendDingTalkCookieExpiredNotification(anchorName);
          console.log(`[${anchorName}] Cookie失效钉钉通知发送完成`);
        } catch (dingError) {
          console.error(`[${anchorName}] 发送Cookie失效钉钉通知失败:`, dingError);
        }
      } catch (updateError) {
        console.error(`[${anchorName}] 更新主播状态失败:`, updateError);
        // 不影响同步记录的保存，继续执行
      }
    }

    const result = await database.run(SQL_STATEMENTS.INSERT_SYNC_LOG, [
      anchorId,
      anchorName,
      syncStatus,
      reason || '',
      orderCount || 0,
      currentTimeString,
      currentTimeString,
      currentTimeString
    ]);

    console.log(`[${anchorName}] 同步记录已保存: ${syncStatus}, 订单数: ${orderCount}, ID: ${result.meta.last_row_id}`);
    return result;
  } catch (error) {
    console.error(`[${anchorName}] 保存同步记录失败:`, error);
    return null;
  }
}

/**
 * 为所有主播生成报表统计
 */
async function generateReportsForAllAnchors(startTime, endTime) {
  try {
    // 获取所有活跃主播
    const activeAnchors = await getActiveAnchors();
    if (!activeAnchors || activeAnchors.length === 0) {
      console.log('没有找到活跃的主播，跳过报表统计');
      return;
    }

    console.log(`开始为 ${activeAnchors.length} 个主播生成报表统计...`);

    // 为每个主播生成报表
    for (const anchor of activeAnchors) {
      try {
        await generateReportForAnchor(anchor.anchor_id, anchor.anchor_name, startTime, endTime);
        console.log(`[${anchor.anchor_name}] 报表统计完成`);
      } catch (error) {
        console.error(`[${anchor.anchor_name}] 报表统计失败:`, error);
      }
    }

    console.log('所有主播报表统计完成');
  } catch (error) {
    console.error('生成所有主播报表统计失败:', error);
    throw error;
  }
}

/**
 * 为单个主播生成报表统计 - 优化版本，使用聚合查询
 */
async function generateReportForAnchor(anchorId, anchorName, startTime, endTime) {
  try {
    console.log(`[${anchorName}] 开始同步报表...`);

    // 将API时间格式转换为数据库查询格式
    const startDate = convertApiTimeToDbTime(startTime);
    const endDate = convertApiTimeToDbTime(endTime);

    // 使用一次聚合查询获取所有日期的统计数据
    const statsQuery = `
      SELECT
        DATE(order_paid_time) as report_date,
        COUNT(*) as order_count,
        COALESCE(SUM(order_amount), 0) as order_amount,
        COALESCE(SUM(predict_amount), 0) as commission,
        COALESCE(SUM(buy_amount), 0) as buy_count,
        COALESCE(SUM(CASE WHEN refund_amount > 0 THEN 1 ELSE 0 END), 0) as refund_count,
        COALESCE(SUM(CASE WHEN refund_amount > 0 THEN refund_amount ELSE 0 END), 0) as refund_amount
      FROM orders
      WHERE ad_user_nick = ?
        AND order_paid_time >= ?
        AND order_paid_time <= ?
      GROUP BY DATE(order_paid_time)
      ORDER BY report_date
    `;

    const startDateTime = `${startDate} 00:00:00`;
    const endDateTime = `${endDate} 23:59:59`;

    const result = await database.all(statsQuery, [anchorName, startDateTime, endDateTime]);

    const dailyStats = result.results || [];

    // 批量插入或更新报表记录
    for (const stats of dailyStats) {
      if (stats.order_count > 0) {
        await upsertReport(anchorId, anchorName, stats.report_date, stats);
      }
    }

    console.log(`[${anchorName}] 报表同步完成，共统计 ${dailyStats.length} 天数据`);
  } catch (error) {
    console.error(`[${anchorName}] 生成报表统计失败:`, error);
    throw error;
  }
}



/**
 * 插入或更新报表记录
 */
async function upsertReport(anchorId, anchorName, reportDate, stats) {
  try {
    const currentTimeString = getCurrentTimeString();

    const result = await database.run(SQL_STATEMENTS.UPSERT_REPORT, [
      anchorId,
      anchorName,
      reportDate,
      stats.order_count || 0,
      parseFloat(stats.order_amount) || 0,
      parseFloat(stats.commission) || 0,
      stats.buy_count || 0,
      stats.refund_count || 0,
      parseFloat(stats.refund_amount) || 0,
      currentTimeString,
      currentTimeString
    ]);

    return result;
  } catch (error) {
    console.error(`[${anchorName}] 保存报表记录失败:`, error);
    throw error;
  }
}

/**
 * 将API时间格式转换为数据库时间格式
 * API格式: "20250120 00:00:00" -> DB格式: "2025-01-20"
 */
function convertApiTimeToDbTime(apiTime) {
  if (!apiTime || typeof apiTime !== 'string') {
    throw new Error('无效的API时间格式');
  }

  const match = apiTime.match(/^(\d{4})(\d{2})(\d{2})\s/);
  if (!match) {
    throw new Error(`无效的API时间格式: ${apiTime}`);
  }

  const [, year, month, day] = match;
  return `${year}-${month}-${day}`;
}

/**
 * 发送钉钉佣金统计通知
 */
async function sendDingTalkCommissionNotification() {
  try {
    const dingKey = config.dingtalk.key;
    if (!dingKey) {
      console.log('未配置钉钉机器人密钥，跳过通知发送');
      return;
    }

    // 获取所有主播的佣金统计数据
    const commissionData = await getAnchorCommissionStats();
    if (!commissionData || commissionData.length === 0) {
      console.log('没有找到佣金数据，跳过通知发送');
      return;
    }

    // 构建钉钉消息内容
    const message = buildDingTalkMessage(commissionData);

    // 发送钉钉消息
    await sendDingTalkMessage(dingKey, message);

  } catch (error) {
    console.error('发送钉钉佣金统计通知失败:', error);
    throw error;
  }
}

/**
 * 获取所有主播的佣金统计数据（今天和本月）
 */
async function getAnchorCommissionStats() {
  try {
    // 获取当前时间的今天和本月
    const currentTime = getCurrentTime();
    const today = formatDateTime(currentTime, 'db').split(' ')[0]; // 格式: 2025-01-20
    const thisMonth = `${currentTime.getFullYear()}-${String(currentTime.getMonth() + 1).padStart(2, '0')}`; // 格式: 2025-01

    console.log(`查询佣金统计 - 今天: ${today}, 本月: ${thisMonth}`);

    // 查询今天的佣金数据
    const todayQuery = `
      SELECT anchor_name, COALESCE(SUM(commission), 0) as today_commission
      FROM reports
      WHERE report_date = ?
      GROUP BY anchor_name
      ORDER BY anchor_name
    `;

    // 查询本月的佣金数据
    const monthQuery = `
      SELECT anchor_name, COALESCE(SUM(commission), 0) as month_commission
      FROM reports
      WHERE report_date LIKE ?
      GROUP BY anchor_name
      ORDER BY anchor_name
    `;

    const [todayResult, monthResult] = await Promise.all([
      database.all(todayQuery, [today]),
      database.all(monthQuery, [`${thisMonth}%`])
    ]);

    // 合并今天和本月的数据
    const todayData = new Map();
    const monthData = new Map();

    (todayResult.results || []).forEach(row => {
      todayData.set(row.anchor_name, parseFloat(row.today_commission) || 0);
    });

    (monthResult.results || []).forEach(row => {
      monthData.set(row.anchor_name, parseFloat(row.month_commission) || 0);
    });

    // 获取所有主播名称
    const allAnchors = new Set([...todayData.keys(), ...monthData.keys()]);

    const result = Array.from(allAnchors).map(anchorName => ({
      anchorName,
      todayCommission: todayData.get(anchorName) || 0,
      monthCommission: monthData.get(anchorName) || 0
    })).sort((a, b) => a.anchorName.localeCompare(b.anchorName));

    console.log(`获取到 ${result.length} 个主播的佣金数据`);
    return result;

  } catch (error) {
    console.error('获取主播佣金统计数据失败:', error);
    throw error;
  }
}

/**
 * 构建钉钉消息内容
 */
function buildDingTalkMessage(commissionData) {
  const currentTime = getCurrentTime();
  const today = `${currentTime.getFullYear()}-${String(currentTime.getMonth() + 1).padStart(2, '0')}-${String(currentTime.getDate()).padStart(2, '0')}`;
  const thisMonth = `${currentTime.getFullYear()}年${currentTime.getMonth() + 1}月`;

  let content = `📊 **[主播佣金统计报告]**\n`;
  content += `🕐 统计时间：${today}\n\n`;

  if (commissionData.length === 0) {
    content += `暂无佣金数据`;
  } else {
    commissionData.forEach(data => {
      content += `👤 **${data.anchorName}**\n`;
      content += `   今日佣金：¥${data.todayCommission.toFixed(2)}\n`;
      content += `   ${thisMonth}佣金：¥${data.monthCommission.toFixed(2)}\n\n`;
    });

    // 计算总计
    const totalToday = commissionData.reduce((sum, data) => sum + data.todayCommission, 0);
    const totalMonth = commissionData.reduce((sum, data) => sum + data.monthCommission, 0);

    content += `📈 **汇总统计**\n`;
    content += `   今日总佣金：¥${totalToday.toFixed(2)}\n`;
    content += `   ${thisMonth}总佣金：¥${totalMonth.toFixed(2)}`;
  }

  return {
    msgtype: "text",
    text: {
      content: content
    }
  };
}

/**
 * 发送钉钉消息
 */
async function sendDingTalkMessage(dingKey, message) {
  try {
    const url = `https://oapi.dingtalk.com/robot/send?access_token=${dingKey}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(message)
    });

    const result = await response.json();

    if (result.errcode === 0) {
      console.log('钉钉消息发送成功');
    } else {
      console.error('钉钉消息发送失败:', result);
      throw new Error(`钉钉API错误: ${result.errmsg || '未知错误'}`);
    }

    return result;
  } catch (error) {
    console.error('发送钉钉消息失败:', error);
    throw error;
  }
}

/**
 * 发送主播Cookie失效钉钉通知
 */
async function sendDingTalkCookieExpiredNotification(anchorName) {
  try {
    const dingKey = config.dingtalk.key;
    if (!dingKey) {
      console.log('未配置钉钉机器人密钥，跳过Cookie失效通知发送');
      return;
    }

    // 构建Cookie失效通知消息
    const message = buildCookieExpiredMessage(anchorName);

    // 发送钉钉消息
    await sendDingTalkMessage(dingKey, message);

  } catch (error) {
    console.error('发送钉钉Cookie失效通知失败:', error);
    throw error;
  }
}

/**
 * 构建Cookie失效通知消息内容
 */
function buildCookieExpiredMessage(anchorName) {
  const currentTime = getCurrentTime();
  const currentTimeStr = `${currentTime.getFullYear()}-${String(currentTime.getMonth() + 1).padStart(2, '0')}-${String(currentTime.getDate()).padStart(2, '0')} ${String(currentTime.getHours()).padStart(2, '0')}:${String(currentTime.getMinutes()).padStart(2, '0')}:${String(currentTime.getSeconds()).padStart(2, '0')}`;

  const content = `🚨 **[主播Cookie失效警告]**\n\n` +
                 `👤 主播：${anchorName}\n` +
                 `⚠️ 状态：Cookie已失效，需要重新登录\n` +
                 `🕐 检测时间：${currentTimeStr}\n` +
                 `📝 说明：该主播已被自动设置为失效状态，请及时更新Cookie信息`;

  return {
    msgtype: "text",
    text: {
      content: content
    }
  };
}
