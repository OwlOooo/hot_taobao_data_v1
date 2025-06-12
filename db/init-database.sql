CREATE TABLE orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    biz_order_id TEXT UNIQUE,
    parent_order_id TEXT,
    seller_nick TEXT,
    item_id INTEGER,
    item_title TEXT,
    ad_user_nick TEXT,
    agency_nick TEXT,
    order_status TEXT,
    order_paid_time DATETIME,
    order_amount DECIMAL(10,2),
    order_commission_amount DECIMAL(10,2),
    predict_amount DECIMAL(10,2),
    seller_commission_ratio TEXT,
    remark TEXT,
    refund_amount DECIMAL(10,2),
    predict_total_amount DECIMAL(10,2),
    out_ad_user_name TEXT,
    out_ad_user_fee DECIMAL(10,2),
    out_ad_user_ratio TEXT,
    out_ad_user_type TEXT,
    rid TEXT,
    end_time INTEGER,
    picture TEXT,
    refund_end_time INTEGER,
    partner_ratio TEXT,
    partner_predict_amount DECIMAL(10,2),
    modify_time DATETIME,
    extend_info TEXT,
    buy_amount INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_orders_biz_order_id ON orders(biz_order_id);
CREATE INDEX idx_orders_seller_nick ON orders(seller_nick);
CREATE INDEX idx_orders_ad_user_nick ON orders(ad_user_nick);
CREATE INDEX idx_orders_order_status ON orders(order_status);
CREATE INDEX idx_orders_order_paid_time ON orders(order_paid_time);


CREATE TABLE anchors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    anchor_name TEXT NOT NULL,
    anchor_id TEXT UNIQUE NOT NULL,
    anchor_cookie TEXT,
    password TEXT,
    status TEXT DEFAULT 'active',
    total_orders INTEGER DEFAULT 0,
    total_amount REAL DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_anchors_anchor_id ON anchors(anchor_id);
CREATE INDEX idx_anchors_created_at ON anchors(created_at);
CREATE INDEX idx_anchors_status ON anchors(status);

CREATE TABLE sync_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    anchor_id TEXT NOT NULL,
    anchor_name TEXT NOT NULL,
    sync_status TEXT NOT NULL CHECK (sync_status IN ('成功', '失败')),
    reason TEXT,
    order_count INTEGER DEFAULT 0,
    sync_time TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_sync_logs_anchor_id ON sync_logs(anchor_id);
CREATE INDEX idx_sync_logs_sync_status ON sync_logs(sync_status);
CREATE INDEX idx_sync_logs_sync_time ON sync_logs(sync_time);
CREATE INDEX idx_sync_logs_created_at ON sync_logs(created_at);

CREATE TABLE reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    anchor_id TEXT NOT NULL,
    anchor_name TEXT NOT NULL,
    report_date TEXT NOT NULL,
    order_count INTEGER DEFAULT 0,
    order_amount DECIMAL(10,2) DEFAULT 0,
    commission DECIMAL(10,2) DEFAULT 0,
    buy_count INTEGER DEFAULT 0,
    refund_count INTEGER DEFAULT 0,
    refund_amount DECIMAL(10,2) DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_reports_anchor_id ON reports(anchor_id);
CREATE INDEX idx_reports_report_date ON reports(report_date);
CREATE INDEX idx_reports_created_at ON reports(created_at);

CREATE UNIQUE INDEX idx_reports_unique_anchor_date ON reports(anchor_id, report_date);
