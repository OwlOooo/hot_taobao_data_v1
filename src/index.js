/**
 * 淘宝订单数据管理 Node.js Express 路由
 */

import express from 'express';
import { config } from './config.js';
import { database } from './database.js';
import { syncSingleAnchor } from './job.js';

// 创建路由器
const router = express.Router();

// 常量定义
const CONSTANTS = {
  AUTH: {
    SPECIAL_APIS: ['orders', 'stats', 'export', 'anchors', 'reports']
  },
  PAGINATION: {
    DEFAULT_PAGE: 1,
    DEFAULT_LIMIT: 10,
    DEFAULT_SORT_FIELD: 'created_at',
    DEFAULT_SORT_ORDER: 'DESC'
  }
};

// 中间件：验证API密钥
async function authMiddleware(req, res, next) {
  try {
    const authResult = await validateApiKey(req);
    if (!authResult.valid) {
      return res.status(401).json({
        error: "invalid_api_key",
        message: "无效的访问密码"
      });
    }
    req.authResult = authResult;
    next();
  } catch (error) {
    console.error('认证中间件错误:', error);
    res.status(500).json({
      error: "auth_error",
      message: "认证失败"
    });
  }
}

// API路由定义
router.get("/api/orders", authMiddleware, handleOrdersData);
router.get("/api/stats", authMiddleware, handleStatsData);
router.get("/api/export", authMiddleware, handleExportData);
router.get("/api/sellers", authMiddleware, handleSellerNames);
router.get("/api/anchors", authMiddleware, handleAnchorNames);
router.post("/api/anchors", authMiddleware, handleAddAnchor);
router.get("/api/anchors/list", authMiddleware, handleAnchorsData);
router.get("/api/anchors/stats", authMiddleware, handleAnchorsStats);
router.post("/api/anchors/check-password", authMiddleware, handleCheckPassword);
router.get("/api/anchor-latest-sync", authMiddleware, handleAnchorLatestSync);
router.get("/api/sync-logs", authMiddleware, handleSyncLogsData);
router.get("/api/reports", authMiddleware, handleReportsData);

// 动态路由
router.delete("/api/orders/:bizOrderId", authMiddleware, (req, res) => {
  handleDeleteOrder(req.params.bizOrderId, res);
});

router.get("/api/anchors/:anchorId", authMiddleware, (req, res) => {
  handleGetAnchor(req.params.anchorId, req, res);
});

router.put("/api/anchors/:anchorId", authMiddleware, (req, res) => {
  handleUpdateAnchor(req.params.anchorId, req, res);
});

router.delete("/api/anchors/:anchorId", authMiddleware, (req, res) => {
  handleDeleteAnchor(req.params.anchorId, req, res);
});

// 同步接口（不需要认证）
router.post("/sync-anchor", async (req, res) => {
  try {
    const result = await syncSingleAnchor(req.body);
    res.json(result);
  } catch (error) {
    console.error('同步失败:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

export default router;

/**
 * 公共工具函数
 */

// 解析请求的cookies
function parseCookies(request) {
  const cookieString = request.headers.cookie || '';
  return cookieString.split(';').reduce((cookies, cookie) => {
    const [name, value] = cookie.trim().split('=');
    if (name && value) {
      cookies[name] = decodeURIComponent(value);
    }
    return cookies;
  }, {});
}

// 创建错误响应 - Express版本
function createErrorResponse(error, message, status = 500) {
  return { error, message, status };
}



// 格式化日期
function formatDate(dateStr) {
  if (!dateStr) return "";

  try {
    const date = new Date(dateStr);
    return date.getFullYear() +
          '-' + String(date.getMonth() + 1).padStart(2, '0') +
          '-' + String(date.getDate()).padStart(2, '0') +
          ' ' + String(date.getHours()).padStart(2, '0') +
          ':' + String(date.getMinutes()).padStart(2, '0') +
          ':' + String(date.getSeconds()).padStart(2, '0');
  } catch (e) {
    return dateStr;
  }
}

// 验证访问密码 - Express版本
async function validateApiKey(request) {
  const apiKey = request.headers['x-api-key'];
  const cookies = parseCookies(request);
  const inputPassword = apiKey || cookies['api_key'];

  if (!inputPassword) {
    return {
      valid: false,
      response: createErrorResponse("invalid_api_key", "无效的访问密码", 401)
    };
  }

  // 检查是否为管理员密码
  if (inputPassword === config.auth.password) {
    return {
      valid: true,
      userType: 'admin',
      anchorInfo: null
    };
  }

  // 检查是否为主播密码
  try {
    const result = await database.all(
      "SELECT id, anchor_name, anchor_id FROM anchors WHERE password = ? AND status = 'active'",
      [inputPassword]
    );

    if (result.results?.length > 0) {
      const anchor = result.results[0];
      return {
        valid: true,
        userType: 'anchor',
        anchorInfo: {
          id: anchor.id,
          anchor_name: anchor.anchor_name,
          anchor_id: anchor.anchor_id
        }
      };
    }
  } catch (error) {
    console.error("Error checking anchor password:", error);
  }

  return {
    valid: false,
    response: createErrorResponse("invalid_api_key", "无效的访问密码", 401)
  };
}

// 公共查询和分页处理函数

// 获取分页参数 - Express版本
function getPaginationParams(req) {
  return {
    page: parseInt(req.query.page || CONSTANTS.PAGINATION.DEFAULT_PAGE),
    limit: parseInt(req.query.limit || CONSTANTS.PAGINATION.DEFAULT_LIMIT),
    sortField: req.query.sortField || CONSTANTS.PAGINATION.DEFAULT_SORT_FIELD,
    sortOrder: req.query.sortOrder || CONSTANTS.PAGINATION.DEFAULT_SORT_ORDER
  };
}

// 安全的排序处理
function getSafeSorting(sortField, sortOrder, validFields) {
  const actualSortField = validFields.includes(sortField) ? sortField : validFields[0];
  const actualSortOrder = ['ASC', 'DESC'].includes(sortOrder?.toUpperCase()) ? sortOrder.toUpperCase() : 'DESC';
  return { actualSortField, actualSortOrder };
}

// 应用主播权限过滤 - 根据表类型使用不同的字段
function applyAnchorFilter(filters, authResult, tableType = 'orders') {
  if (authResult.userType === 'anchor' && authResult.anchorInfo) {
    // 根据不同表类型设置相应的字段
    switch (tableType) {
      case 'orders':
        // 订单表使用 ad_user_nick 字段
        filters.anchor = authResult.anchorInfo.anchor_name;
        break;
      case 'anchors':
        // 主播表使用 anchor_name 和 anchor_id 字段
        // filters.anchorName = authResult.anchorInfo.anchor_name;
        filters.anchorId = authResult.anchorInfo.anchor_id;
        break;
      case 'sync_logs':
        // 同步记录表使用 anchor_name 和 anchor_id 字段
        // filters.anchorName = authResult.anchorInfo.anchor_name;
        filters.anchorId = authResult.anchorInfo.anchor_id;
        break;
      case 'reports':
        // 报表表只使用 anchor_id 字段
        filters.anchorId = authResult.anchorInfo.anchor_id;
        break;
    }
  }
  return filters;
}

// 构建查询条件和参数
function buildQueryConditions(filters) {
  const conditions = [];
  const params = [];

  const conditionMap = {
    bizOrderId: { sql: "biz_order_id = ?", value: (v) => v },
    sellerNick: { sql: "seller_nick = ?", value: (v) => v },
    orderStatus: { sql: "order_status = ?", value: (v) => v },
    anchor: { sql: "ad_user_nick = ?", value: (v) => v },
    startDate: { sql: "DATE(order_paid_time) >= ?", value: (v) => v },
    endDate: { sql: "DATE(order_paid_time) <= ?", value: (v) => v },
    reportStartDate: { sql: "DATE(report_date) >= ?", value: (v) => v },
    reportEndDate: { sql: "DATE(report_date) <= ?", value: (v) => v },
    anchorName: { sql: "anchor_name = ?", value: (v) => v },
    anchorId: { sql: "anchor_id = ?", value: (v) => v },
    status: { sql: "status = ?", value: (v) => v },
    syncStatus: { sql: "sync_status = ?", value: (v) => v }
  };

  Object.entries(filters).forEach(([key, value]) => {
    if (value && conditionMap[key]) {
      conditions.push(conditionMap[key].sql);
      params.push(conditionMap[key].value(value));
    }
  });

  return { conditions, params };
}

// 格式化数据通用函数
function formatDataResults(results, dateFields = ['created_at', 'updated_at'], numberFields = []) {
  return results.map(item => {
    const formatted = { ...item };

    // 格式化日期字段
    dateFields.forEach(field => {
      if (formatted[field]) {
        formatted[field] = formatDate(formatted[field]);
      }
    });

    // 格式化数字字段
    numberFields.forEach(field => {
      if (formatted[field] !== undefined) {
        formatted[field] = Number(formatted[field] || 0);
      }
    });

    return formatted;
  });
}

// 密码验证公共函数
async function validatePassword(password, excludeId) {
  if (!password) {
    return {
      isValid: false,
      message: "密码不能为空"
    };
  }

  // 检查是否与系统访问密码相同
  if (password === config.auth.password) {
    return {
      isValid: false,
      message: "密码不能与系统访问密码相同，请使用其他密码"
    };
  }

  let sql = "SELECT anchor_name FROM anchors WHERE password = ?";
  let params = [password];

  if (excludeId) {
    sql += " AND id != ?";
    params.push(excludeId);
  }

  const result = await database.all(sql, params);

  if (result.results.length > 0) {
    return {
      isValid: false,
      message: `密码已被主播"${result.results[0].anchor_name}"使用，请使用其他密码`
    };
  }

  return {
    isValid: true,
    message: "密码可以使用"
  };
}

// 权限检查公共函数
function checkAnchorPermission(authResult, operation = 'modify') {
  if (authResult.userType === 'anchor') {
    const operations = {
      modify: "主播用户无权修改主播信息",
      delete: "主播用户无权删除主播信息",
      add: "主播用户无权添加新主播",
      check: "主播用户无权检查密码"
    };

    return {
      hasPermission: false,
      message: operations[operation] || "主播用户无权执行此操作"
    };
  }

  return {
    hasPermission: true,
    message: ""
  };
}



/**
 * 处理订单数据API请求 - Express版本
 */
async function handleOrdersData(req, res) {
  try {
    const { page, limit, sortField, sortOrder } = getPaginationParams(req);

    // 构建筛选条件
    let filters = {
      bizOrderId: req.query.bizOrderId,
      sellerNick: req.query.sellerNick,
      orderStatus: req.query.orderStatus,
      anchor: req.query.anchor,
      startDate: req.query.startDate,
      endDate: req.query.endDate
    };

    filters = applyAnchorFilter(filters, req.authResult, 'orders');
    const { conditions, params } = buildQueryConditions(filters);

    // 构建SQL
    const baseFields = `biz_order_id, seller_nick, item_title, order_status, order_paid_time,
                        order_amount, predict_amount, seller_commission_ratio, ad_user_nick,
                        buy_amount, created_at, updated_at`;
    let sql = `SELECT ${baseFields} FROM orders`;
    let countSql = "SELECT COUNT(*) as total FROM orders";

    if (conditions.length > 0) {
      const whereClause = " WHERE " + conditions.join(" AND ");
      sql += whereClause;
      countSql += whereClause;
    }

    const validSortFields = ['biz_order_id', 'seller_nick', 'order_status', 'order_paid_time',
                            'order_amount', 'predict_amount', 'buy_amount', 'created_at', 'updated_at'];
    const { actualSortField, actualSortOrder } = getSafeSorting(sortField, sortOrder, validSortFields);

    sql += ` ORDER BY ${actualSortField} ${actualSortOrder} LIMIT ? OFFSET ?`;
    const offset = (page - 1) * limit;

    // 执行查询
    const [countResult, dataResult] = await Promise.all([
      database.all(countSql, params),
      database.all(sql, [...params, limit, offset])
    ]);

    const total = countResult.results[0]?.total || 0;
    const orders = formatDataResults(
      dataResult.results,
      ['order_paid_time', 'created_at', 'updated_at'],
      ['order_amount', 'predict_amount']
    );

    res.json({
      orders,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      },
      userInfo: {
        userType: req.authResult.userType,
        anchorInfo: req.authResult.anchorInfo
      }
    });
  } catch (error) {
    console.error("Error fetching orders:", error);
    res.status(500).json({
      error: "Failed to fetch orders",
      message: error.message
    });
  }
}

/**
 * 处理统计数据API请求 - Express版本
 */
async function handleStatsData(req, res) {
  try {
    let filters = {
      bizOrderId: req.query.bizOrderId,
      sellerNick: req.query.sellerNick,
      orderStatus: req.query.orderStatus,
      anchor: req.query.anchor,
      startDate: req.query.startDate,
      endDate: req.query.endDate
    };

    filters = applyAnchorFilter(filters, req.authResult, 'orders');
    const { conditions, params } = buildQueryConditions(filters);
    const whereClause = conditions.length > 0 ? " WHERE " + conditions.join(" AND ") : "";

    const statsSql = `
      SELECT
        COUNT(*) as totalOrders,
        SUM(order_amount) as totalOrderAmount,
        SUM(predict_amount) as totalPredictAmount,
        AVG(order_amount) as avgOrderAmount,
        SUM(buy_amount) as totalQuantity,
        COUNT(DISTINCT ad_user_nick) as totalAnchors
      FROM orders
      ${whereClause}
    `;

    const statsResult = await database.all(statsSql, params);
    const stats = statsResult.results[0];

    res.json({
      totalOrders: stats.totalOrders || 0,
      totalOrderAmount: Number(stats.totalOrderAmount) || 0,
      totalPredictAmount: Number(stats.totalPredictAmount) || 0,
      avgOrderAmount: Number(stats.avgOrderAmount) || 0,
      totalQuantity: stats.totalQuantity || 0,
      totalAnchors: stats.totalAnchors || 0,
      userInfo: {
        userType: req.authResult.userType,
        anchorInfo: req.authResult.anchorInfo
      }
    });
  } catch (error) {
    console.error("Error fetching stats:", error);
    res.status(500).json({
      error: "Failed to fetch statistics",
      message: error.message
    });
  }
}

/**
 * 处理导出数据API请求 - Express版本
 */
async function handleExportData(req, res) {
  try {
    let filters = {
      bizOrderId: req.query.bizOrderId,
      sellerNick: req.query.sellerNick,
      orderStatus: req.query.orderStatus,
      anchor: req.query.anchor,
      startDate: req.query.startDate,
      endDate: req.query.endDate
    };

    filters = applyAnchorFilter(filters, req.authResult, 'orders');
    const { conditions, params } = buildQueryConditions(filters);

    let sql = "SELECT * FROM orders";
    if (conditions.length > 0) {
      sql += " WHERE " + conditions.join(" AND ");
    }
    sql += " ORDER BY order_paid_time DESC";

    const result = await database.all(sql, params);
    const orders = formatDataResults(
      result.results,
      ['order_paid_time', 'modify_time', 'created_at', 'updated_at'],
      ['order_amount', 'predict_amount']
    );

    res.json({
      orders,
      total: orders.length,
      userInfo: {
        userType: req.authResult.userType,
        anchorInfo: req.authResult.anchorInfo
      }
    });
  } catch (error) {
    console.error("Error exporting orders:", error);
    res.status(500).json({
      error: "Failed to export orders",
      message: error.message
    });
  }
}

/**
 * 获取商家列表 - Express版本
 */
async function handleSellerNames(req, res) {
  try {
    const sql = "SELECT DISTINCT seller_nick FROM orders WHERE seller_nick IS NOT NULL AND seller_nick != '' ORDER BY seller_nick";
    const result = await database.all(sql);
    const sellerNames = result.results?.map(item => item.seller_nick) || [];

    res.json({ sellerNames });
  } catch (error) {
    console.error("Error fetching seller names:", error);
    res.status(500).json({
      error: "Failed to fetch seller names",
      message: error.message
    });
  }
}

/**
 * 获取主播列表 - 支持两种模式：名称列表和完整信息 - Express版本
 */
async function handleAnchorNames(req, res) {
  try {
    const mode = req.query.mode || "names";

    if (mode === "full") {
      // 返回完整的主播信息（用于同步弹窗）
      let sql = "SELECT id, anchor_name, anchor_id, status, created_at, updated_at FROM anchors";
      let params = [];
      let whereConditions = [];

      // 如果是主播用户，只返回自己的信息
      if (req.authResult.userType === 'anchor' && req.authResult.anchorInfo) {
        whereConditions.push("id = ?");
        params.push(req.authResult.anchorInfo.id);
      }

      // 添加WHERE子句
      if (whereConditions.length > 0) {
        sql += " WHERE " + whereConditions.join(" AND ");
      }

      sql += " ORDER BY anchor_name";
      const result = await database.all(sql, params);

      const anchors = result.results?.map(anchor => ({
        ...anchor,
        created_at: formatDate(anchor.created_at),
        updated_at: formatDate(anchor.updated_at)
      })) || [];

      res.json({
        anchors,
        userInfo: {
          userType: req.authResult.userType,
          anchorInfo: req.authResult.anchorInfo
        }
      });
    } else {
      // 返回主播名称列表（用于筛选下拉框）
      let sql = "SELECT DISTINCT ad_user_nick FROM orders WHERE ad_user_nick IS NOT NULL AND ad_user_nick != ''";
      let params = [];

      // 如果是主播用户，只返回自己的名称
      if (req.authResult.userType === 'anchor' && req.authResult.anchorInfo) {
        sql += " AND ad_user_nick = ?";
        params.push(req.authResult.anchorInfo.anchor_name);
      }

      sql += " ORDER BY ad_user_nick";
      const result = await database.all(sql, params);
      const anchorNames = result.results?.map(item => item.ad_user_nick) || [];

      res.json({
        anchorNames,
        userInfo: {
          userType: req.authResult.userType,
          anchorInfo: req.authResult.anchorInfo
        }
      });
    }
  } catch (error) {
    console.error("Error fetching anchor data:", error);
    res.status(500).json({
      error: "Failed to fetch anchor data",
      message: error.message
    });
  }
}

/**
 * 处理删除订单数据请求 - Express版本
 */
async function handleDeleteOrder(bizOrderId, res) {
  try {
    if (!bizOrderId) {
      return res.status(400).json({
        error: "invalid_order_id",
        message: "无效的订单ID"
      });
    }

    // 检查订单是否存在
    const checkResult = await database.all(
      "SELECT biz_order_id FROM orders WHERE biz_order_id = ?",
      [bizOrderId]
    );

    if (checkResult.results.length === 0) {
      return res.status(404).json({
        error: "order_not_found",
        message: "订单不存在"
      });
    }

    // 删除数据
    await database.run(
      "DELETE FROM orders WHERE biz_order_id = ?",
      [bizOrderId]
    );

    res.json({
      success: true,
      message: "订单删除成功"
    });
  } catch (error) {
    console.error("Error deleting order:", error);
    res.status(500).json({
      error: "delete_failed",
      message: "删除订单失败: " + error.message
    });
  }
}



/**
 * 获取主播列表数据 - Express版本
 */
async function handleAnchorsData(req, res) {
  try {
    const { page, limit } = getPaginationParams(req);

    let filters = {
      anchorName: req.query.anchorName,
      anchorId: req.query.anchorId,
      status: req.query.status
    };

    filters = applyAnchorFilter(filters, req.authResult, 'anchors');
    const { conditions, params } = buildQueryConditions(filters);

    let sql = "SELECT id, anchor_name, anchor_id, status, created_at, updated_at FROM anchors";
    let countSql = "SELECT COUNT(*) as total FROM anchors";

    if (conditions.length > 0) {
      const whereClause = " WHERE " + conditions.join(" AND ");
      sql += whereClause;
      countSql += whereClause;
    }

    sql += " ORDER BY created_at DESC LIMIT ? OFFSET ?";
    const offset = (page - 1) * limit;

    const [countResult, dataResult] = await Promise.all([
      database.all(countSql, params),
      database.all(sql, [...params, limit, offset])
    ]);

    const total = countResult.results[0]?.total || 0;
    const anchors = formatDataResults(dataResult.results);

    res.json({
      anchors,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      },
      userInfo: {
        userType: req.authResult.userType,
        anchorInfo: req.authResult.anchorInfo
      }
    });
  } catch (error) {
    console.error("Error fetching anchors:", error);
    res.status(500).json({
      error: "Failed to fetch anchors",
      message: error.message
    });
  }
}

/**
 * 获取主播统计数据 - Express版本
 */
async function handleAnchorsStats(req, res) {
  try {
    let filters = {
      anchorName: req.query.anchorName,
      anchorId: req.query.anchorId,
      status: req.query.status
    };

    filters = applyAnchorFilter(filters, req.authResult, 'anchors');
    const { conditions, params } = buildQueryConditions(filters);
    const whereClause = conditions.length > 0 ? " WHERE " + conditions.join(" AND ") : "";

    const statsSql = `
      SELECT
        COUNT(*) as totalAnchors,
        COUNT(CASE WHEN status = 'active' THEN 1 END) as activeAnchors
      FROM anchors
      ${whereClause}
    `;

    const statsResult = await database.all(statsSql, params);
    const stats = statsResult.results[0];

    res.json({
      totalAnchors: stats.totalAnchors || 0,
      activeAnchors: stats.activeAnchors || 0,
      userInfo: {
        userType: req.authResult.userType,
        anchorInfo: req.authResult.anchorInfo
      }
    });
  } catch (error) {
    console.error("Error fetching anchors stats:", error);
    res.status(500).json({
      error: "Failed to fetch anchors statistics",
      message: error.message
    });
  }
}

/**
 * 添加主播 - Express版本
 */
async function handleAddAnchor(req, res) {
  try {
    const permissionCheck = checkAnchorPermission(req.authResult, 'add');
    if (!permissionCheck.hasPermission) {
      return res.status(403).json({
        error: "permission_denied",
        message: permissionCheck.message
      });
    }

    const { anchor_name, anchor_id, anchor_cookie, status, password } = req.body;

    // 验证必填字段
    if (!anchor_name || !anchor_id || !password || !anchor_cookie) {
      return res.status(400).json({
        error: "missing_fields",
        message: "主播名称、主播ID、密码和主播Cookie为必填字段"
      });
    }

    // 验证密码
    const passwordValidation = await validatePassword(password, null);
    if (!passwordValidation.isValid) {
      return res.status(400).json({
        error: "invalid_password",
        message: passwordValidation.message
      });
    }

    // 检查主播ID是否已存在
    const checkResult = await database.all(
      "SELECT anchor_id FROM anchors WHERE anchor_id = ?",
      [anchor_id]
    );

    if (checkResult.results.length > 0) {
      return res.status(400).json({
        error: "duplicate_anchor_id",
        message: "主播ID已存在"
      });
    }

    // 插入新主播
    const insertResult = await database.run(`
      INSERT INTO anchors (anchor_name, anchor_id, anchor_cookie, status, password, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `, [anchor_name, anchor_id, anchor_cookie, status || 'active', password]);

    res.json({
      success: true,
      message: "主播添加成功",
      id: insertResult.meta.last_row_id
    });
  } catch (error) {
    console.error("Error adding anchor:", error);
    res.status(500).json({
      error: "add_anchor_failed",
      message: "添加主播失败: " + error.message
    });
  }
}

/**
 * 获取单个主播 - Express版本
 */
async function handleGetAnchor(anchorId, req, res) {
  try {
    if (!anchorId) {
      return res.status(400).json({ error: "无效的主播ID" });
    }

    // 如果是主播用户，只能查看自己的信息
    if (req.authResult.userType === 'anchor' && req.authResult.anchorInfo) {
      if (parseInt(anchorId) !== req.authResult.anchorInfo.id) {
        return res.status(403).json({ error: "无权访问其他主播信息" });
      }
    }

    // 查询主播信息（包含密码字段）
    const result = await database.all(
      "SELECT id, anchor_name, anchor_id, anchor_cookie, status, password, total_orders, total_amount, created_at, updated_at FROM anchors WHERE id = ?",
      [anchorId]
    );

    if (result.results.length === 0) {
      return res.status(404).json({ error: "主播不存在" });
    }

    const anchor = result.results[0];

    // 格式化数据
    const formattedAnchor = {
      ...anchor,
      created_at: formatDate(anchor.created_at),
      updated_at: formatDate(anchor.updated_at)
    };

    res.json({
      anchor: formattedAnchor
    });
  } catch (error) {
    console.error("Error fetching anchor:", error);
    res.status(500).json({
      error: "获取主播信息失败",
      details: error.message
    });
  }
}

/**
 * 更新主播 - Express版本
 */
async function handleUpdateAnchor(anchorId, req, res) {
  try {
    if (!anchorId) {
      return res.status(400).json({
        error: "invalid_anchor_id",
        message: "无效的主播ID"
      });
    }

    const permissionCheck = checkAnchorPermission(req.authResult, 'modify');
    if (!permissionCheck.hasPermission) {
      return res.status(403).json({
        error: "permission_denied",
        message: permissionCheck.message
      });
    }

    const { anchor_name, anchor_id, anchor_cookie, status, password } = req.body;

    // 验证必填字段
    if (!anchor_name || !anchor_id || !password || !anchor_cookie) {
      return res.status(400).json({
        error: "missing_fields",
        message: "主播名称、主播ID、密码和主播Cookie为必填字段"
      });
    }

    // 验证密码
    const passwordValidation = await validatePassword(password, anchorId);
    if (!passwordValidation.isValid) {
      return res.status(400).json({
        error: "invalid_password",
        message: passwordValidation.message
      });
    }

    // 检查主播是否存在
    const checkResult = await database.all(
      "SELECT id FROM anchors WHERE id = ?",
      [anchorId]
    );

    if (checkResult.results.length === 0) {
      return res.status(404).json({
        error: "anchor_not_found",
        message: "主播不存在"
      });
    }

    // 检查主播ID是否被其他主播使用
    const duplicateResult = await database.all(
      "SELECT id FROM anchors WHERE anchor_id = ? AND id != ?",
      [anchor_id, anchorId]
    );

    if (duplicateResult.results.length > 0) {
      return res.status(400).json({
        error: "duplicate_anchor_id",
        message: "主播ID已被其他主播使用"
      });
    }

    // 更新主播信息
    await database.run(`
      UPDATE anchors
      SET anchor_name = ?, anchor_id = ?, anchor_cookie = ?, status = ?, password = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [anchor_name, anchor_id, anchor_cookie, status || 'active', password, anchorId]);

    res.json({
      success: true,
      message: "主播更新成功"
    });
  } catch (error) {
    console.error("Error updating anchor:", error);
    res.status(500).json({
      error: "update_anchor_failed",
      message: "更新主播失败: " + error.message
    });
  }
}

/**
 * 删除主播 - Express版本
 */
async function handleDeleteAnchor(anchorId, req, res) {
  try {
    if (!anchorId) {
      return res.status(400).json({
        error: "invalid_anchor_id",
        message: "无效的主播ID"
      });
    }

    const permissionCheck = checkAnchorPermission(req.authResult, 'delete');
    if (!permissionCheck.hasPermission) {
      return res.status(403).json({
        error: "permission_denied",
        message: permissionCheck.message
      });
    }

    // 检查主播是否存在
    const checkResult = await database.all(
      "SELECT id FROM anchors WHERE id = ?",
      [anchorId]
    );

    if (checkResult.results.length === 0) {
      return res.status(404).json({
        error: "anchor_not_found",
        message: "主播不存在"
      });
    }

    // 删除主播
    await database.run(
      "DELETE FROM anchors WHERE id = ?",
      [anchorId]
    );

    res.json({
      success: true,
      message: "主播删除成功"
    });
  } catch (error) {
    console.error("Error deleting anchor:", error);
    res.status(500).json({
      error: "delete_anchor_failed",
      message: "删除主播失败: " + error.message
    });
  }
}

/**
 * 获取主播最近同步记录 - Express版本
 */
async function handleAnchorLatestSync(req, res) {
  try {
    const anchorName = req.query.anchorName;

    if (!anchorName) {
      return res.status(400).json({
        error: "missing_anchor_name",
        message: "主播名称为必填参数"
      });
    }

    // 查询该主播最近的一条同步记录
    const sql = `
      SELECT anchor_id, anchor_name, sync_status, reason, order_count, sync_time, created_at
      FROM sync_logs
      WHERE anchor_name = ?
      ORDER BY created_at DESC
      LIMIT 1
    `;

    const result = await database.all(sql, [anchorName]);

    if (result.results && result.results.length > 0) {
      const syncLog = result.results[0];
      // 格式化时间
      const formattedSyncLog = {
        ...syncLog,
        sync_time: formatDate(syncLog.sync_time),
        created_at: formatDate(syncLog.created_at),
        order_count: Number(syncLog.order_count || 0)
      };

      res.json({ syncLog: formattedSyncLog });
    } else {
      res.json({ syncLog: null });
    }
  } catch (error) {
    console.error("Error fetching anchor latest sync:", error);
    res.status(500).json({
      error: "Failed to fetch anchor latest sync",
      message: error.message
    });
  }
}

/**
 * 处理同步记录数据API请求 - Express版本
 */
async function handleSyncLogsData(req, res) {
  try {
    const { page, limit, sortField, sortOrder } = getPaginationParams(req);

    let filters = {
      anchorId: req.query.anchorId,
      anchorName: req.query.anchorName,
      syncStatus: req.query.syncStatus,
      startDate: req.query.startDate,
      endDate: req.query.endDate
    };

    filters = applyAnchorFilter(filters, req.authResult, 'sync_logs');
    const { conditions, params } = buildQueryConditions(filters);

    const baseFields = `id, anchor_id, anchor_name, sync_status, reason, order_count, sync_time, created_at`;
    let sql = `SELECT ${baseFields} FROM sync_logs`;
    let countSql = "SELECT COUNT(*) as total FROM sync_logs";

    if (conditions.length > 0) {
      const whereClause = " WHERE " + conditions.join(" AND ");
      sql += whereClause;
      countSql += whereClause;
    }

    const validSortFields = ['id', 'anchor_id', 'anchor_name', 'sync_status', 'order_count', 'sync_time', 'created_at'];
    const { actualSortField, actualSortOrder } = getSafeSorting(sortField, sortOrder, validSortFields);

    sql += ` ORDER BY ${actualSortField} ${actualSortOrder} LIMIT ? OFFSET ?`;
    const offset = (page - 1) * limit;

    let statsSql = `
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN sync_status = '成功' THEN 1 ELSE 0 END) as success_count,
        SUM(CASE WHEN sync_status = '失败' THEN 1 ELSE 0 END) as failed_count,
        SUM(order_count) as total_orders
      FROM sync_logs
    `;

    if (conditions.length > 0) {
      statsSql += " WHERE " + conditions.join(" AND ");
    }

    const [countResult, dataResult, statsResult] = await Promise.all([
      database.all(countSql, params),
      database.all(sql, [...params, limit, offset]),
      database.all(statsSql, params)
    ]);

    const total = countResult.results[0]?.total || 0;
    const stats = statsResult.results[0] || { total: 0, success_count: 0, failed_count: 0, total_orders: 0 };

    const syncLogs = formatDataResults(
      dataResult.results,
      ['sync_time', 'created_at'],
      ['order_count']
    );

    res.json({
      syncLogs,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      },
      stats: {
        total: Number(stats.total || 0),
        successCount: Number(stats.success_count || 0),
        failedCount: Number(stats.failed_count || 0),
        totalOrders: Number(stats.total_orders || 0)
      },
      userInfo: {
        userType: req.authResult.userType,
        anchorInfo: req.authResult.anchorInfo
      }
    });
  } catch (error) {
    console.error("Error fetching sync logs:", error);
    res.status(500).json({
      error: "Failed to fetch sync logs",
      message: error.message
    });
  }
}

/**
 * 检查密码是否重复 - Express版本
 */
async function handleCheckPassword(req, res) {
  try {
    const permissionCheck = checkAnchorPermission(req.authResult, 'check');
    if (!permissionCheck.hasPermission) {
      return res.status(403).json({
        error: "permission_denied",
        message: permissionCheck.message
      });
    }

    const { password, excludeId } = req.body;

    if (!password) {
      return res.status(400).json({
        error: "missing_password",
        message: "密码为必填参数"
      });
    }

    const validation = await validatePassword(password, excludeId);

    res.json({
      isDuplicate: !validation.isValid,
      isValid: validation.isValid,
      message: validation.message,
      usedBy: validation.isValid ? null : (password === config.auth.password ? "系统访问密码" : "其他主播")
    });
  } catch (error) {
    console.error("Error checking password:", error);
    res.status(500).json({
      error: "check_password_failed",
      message: "检查密码失败: " + error.message
    });
  }
}



/**
 * 处理数据报表数据API请求 - Express版本
 */
async function handleReportsData(req, res) {
  try {
    const { page, limit, sortField, sortOrder } = getPaginationParams(req);

    let filters = {
      startDate: req.query.startDate,
      endDate: req.query.endDate,
      anchorId: req.query.anchorId
    };

    filters = applyAnchorFilter(filters, req.authResult, 'reports');

    // 为报表查询添加特殊的日期字段处理
    const reportFilters = { ...filters };
    if (reportFilters.startDate) {
      reportFilters.reportStartDate = reportFilters.startDate;
      delete reportFilters.startDate;
    }
    if (reportFilters.endDate) {
      reportFilters.reportEndDate = reportFilters.endDate;
      delete reportFilters.endDate;
    }

    const { conditions, params } = buildQueryConditions(reportFilters);

    let sql = "SELECT * FROM reports";
    let countSql = "SELECT COUNT(*) as total FROM reports";

    if (conditions.length > 0) {
      const whereClause = " WHERE " + conditions.join(" AND ");
      sql += whereClause;
      countSql += whereClause;
    }

    const validSortFields = ['id', 'anchor_name', 'report_date', 'order_count', 'order_amount', 'commission', 'buy_count', 'refund_count', 'refund_amount', 'created_at', 'updated_at'];
    const { actualSortField, actualSortOrder } = getSafeSorting(sortField, sortOrder, validSortFields);

    sql += ` ORDER BY ${actualSortField} ${actualSortOrder} LIMIT ? OFFSET ?`;
    const offset = (page - 1) * limit;

    const [countResult, dataResult] = await Promise.all([
      database.all(countSql, params),
      database.all(sql, [...params, limit, offset])
    ]);

    const total = countResult.results[0]?.total || 0;
    const reports = formatDataResults(
      dataResult.results,
      ['created_at', 'updated_at'],
      ['order_amount', 'commission', 'refund_amount']
    );

    // 计算统计数据
    const statsConditions = conditions.length > 0 ? " WHERE " + conditions.join(" AND ") : "";
    const statsResult = await database.all(`
      SELECT
        SUM(order_count) as totalOrders,
        SUM(order_amount) as totalOrderAmount,
        SUM(commission) as totalCommission,
        SUM(refund_count) as totalRefundCount,
        SUM(refund_amount) as totalRefundAmount
      FROM reports
      ${statsConditions}
    `, params);

    const stats = statsResult.results[0] || {};

    res.json({
      reports,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      },
      stats: {
        totalOrders: stats.totalOrders || 0,
        totalOrderAmount: Number(stats.totalOrderAmount) || 0,
        totalCommission: Number(stats.totalCommission) || 0,
        totalRefundCount: stats.totalRefundCount || 0,
        totalRefundAmount: Number(stats.totalRefundAmount) || 0
      },
      userInfo: {
        userType: req.authResult.userType,
        anchorInfo: req.authResult.anchorInfo
      }
    });
  } catch (error) {
    console.error("Error fetching reports:", error);
    res.status(500).json({
      error: "Failed to fetch reports",
      message: error.message
    });
  }
}