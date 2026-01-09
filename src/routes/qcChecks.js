// routes/qcChecks.js
const express = require("express");
const router = express.Router();
const pool = require("../db");

// Helper: resolve employee ID from name
const resolveEmployeeId = async (client, empName) => {
  if (!empName) return null;
  const q = await client.query(
    `SELECT id FROM employees WHERE LOWER(emp_name)=LOWER($1) LIMIT 1`,
    [empName]
  );
  return q.rows[0]?.id ?? null;
};

// ====== CREATE QC Check ======
router.post("/", async (req, res) => {
  const client = await pool.connect();
  try {
    const {
      part_code,
      part_name,
      vendor_name,
      vendor_id,
      vendor_type,
      production_date,
      approved_by,
      data_from, // "Create" dari AddQCCheckPage, "Sample" dari LocalSchedulePage
    } = req.body || {};

    console.log("[POST QC Check] Received data:", req.body);

    if (!part_code || !production_date) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields: part_code and production_date are required",
      });
    }

    await client.query("BEGIN");

    // Resolve approved_by to employee ID
    const approvedById = await resolveEmployeeId(client, approved_by);

    const insertQuery = `
      INSERT INTO qc_checks (
        part_code,
        part_name,
        vendor_name,
        vendor_id,
        vendor_type,
        production_date,
        approved_by,
        approved_by_name,
        approved_at,
        data_from,
        status,
        created_at,
        updated_at,
        is_active
      ) VALUES ($1, $2, $3, $4, $5, $6::date, $7, $8, CURRENT_TIMESTAMP, $9, 'Complete', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, true)
      RETURNING 
        id,
        part_code,
        part_name,
        vendor_name,
        vendor_id,
        vendor_type,
        TO_CHAR(production_date, 'YYYY-MM-DD') as production_date,
        approved_by,
        approved_by_name,
        approved_at,
        data_from,
        status,
        created_at
    `;

    const values = [
      part_code,
      part_name || null,
      vendor_name || null,
      vendor_id || null,
      vendor_type || null,
      production_date,
      approvedById,
      approved_by || null, // Store name directly for display
      data_from || "Create",
    ];

    const result = await client.query(insertQuery, values);

    await client.query("COMMIT");

    console.log("[POST QC Check] Successfully created:", result.rows[0]);

    res.status(201).json({
      success: true,
      message: "QC Check created successfully",
      data: result.rows[0],
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("[POST QC Check] Error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to create QC check",
      error: error.message,
    });
  } finally {
    client.release();
  }
});

// ====== GET all QC Checks (for Complete tab) ======
router.get("/", async (req, res) => {
  try {
    const { status, date_from, date_to, part_code, data_from } = req.query;

    console.log("[GET QC Checks] Query params:", req.query);

    let query = `
      SELECT 
        qc.id,
        qc.part_code,
        qc.part_name,
        qc.vendor_name,
        qc.vendor_id,
        qc.vendor_type,
        TO_CHAR(qc.production_date, 'YYYY-MM-DD') as production_date,
        qc.approved_by,
        qc.approved_by_name,
        qc.approved_at,
        qc.data_from,
        qc.status,
        qc.created_at,
        qc.updated_at,
        e.emp_name as approved_by_emp_name
      FROM qc_checks qc
      LEFT JOIN employees e ON e.id = qc.approved_by
      WHERE qc.is_active = true
    `;

    const params = [];
    let paramCount = 0;

    // Filter by status
    if (status) {
      paramCount++;
      query += ` AND qc.status = $${paramCount}`;
      params.push(status);
    }

    // Filter by date range
    if (date_from) {
      paramCount++;
      query += ` AND qc.production_date >= $${paramCount}::date`;
      params.push(date_from);
    }

    if (date_to) {
      paramCount++;
      query += ` AND qc.production_date <= $${paramCount}::date`;
      params.push(date_to);
    }

    // Filter by part code
    if (part_code) {
      paramCount++;
      query += ` AND qc.part_code ILIKE $${paramCount}`;
      params.push(`%${part_code}%`);
    }

    // Filter by data_from
    if (data_from) {
      paramCount++;
      query += ` AND qc.data_from = $${paramCount}`;
      params.push(data_from);
    }

    query += ` ORDER BY qc.created_at DESC, qc.production_date DESC`;

    console.log("[GET QC Checks] Executing query:", query);

    const result = await pool.query(query, params);

    console.log(`[GET QC Checks] Found ${result.rows.length} records`);

    // Format the response to use approved_by_name for display
    const formattedData = result.rows.map((row) => ({
      ...row,
      approved_by: row.approved_by_name || row.approved_by_emp_name || "Unknown",
    }));

    res.json({
      success: true,
      data: formattedData,
      total: formattedData.length,
    });
  } catch (error) {
    console.error("[GET QC Checks] Error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch QC checks",
      error: error.message,
    });
  }
});

// ====== GET single QC Check by ID ======
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const query = `
      SELECT 
        qc.id,
        qc.part_code,
        qc.part_name,
        qc.vendor_name,
        qc.vendor_id,
        qc.vendor_type,
        TO_CHAR(qc.production_date, 'YYYY-MM-DD') as production_date,
        qc.approved_by,
        qc.approved_by_name,
        qc.approved_at,
        qc.data_from,
        qc.status,
        qc.created_at,
        qc.updated_at,
        e.emp_name as approved_by_emp_name
      FROM qc_checks qc
      LEFT JOIN employees e ON e.id = qc.approved_by
      WHERE qc.id = $1 AND qc.is_active = true
    `;

    const result = await pool.query(query, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "QC Check not found",
      });
    }

    const row = result.rows[0];
    res.json({
      success: true,
      data: {
        ...row,
        approved_by: row.approved_by_name || row.approved_by_emp_name || "Unknown",
      },
    });
  } catch (error) {
    console.error("[GET QC Check by ID] Error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch QC check",
      error: error.message,
    });
  }
});

// ====== DELETE QC Check ======
router.delete("/:id", async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;

    console.log(`[DELETE QC Check] Deleting ID: ${id}`);

    await client.query("BEGIN");

    // Check if exists
    const checkQuery = `
      SELECT id FROM qc_checks WHERE id = $1 AND is_active = true
    `;
    const checkResult = await client.query(checkQuery, [id]);

    if (checkResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({
        success: false,
        message: "QC Check not found or already deleted",
      });
    }

    // Soft delete (set is_active to false)
    const deleteQuery = `
      UPDATE qc_checks
      SET is_active = false, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
      RETURNING id
    `;

    const result = await client.query(deleteQuery, [id]);

    await client.query("COMMIT");

    console.log(`[DELETE QC Check] Successfully deleted ID: ${id}`);

    res.json({
      success: true,
      message: "QC Check deleted successfully",
      data: { deletedId: result.rows[0].id },
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("[DELETE QC Check] Error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to delete QC check",
      error: error.message,
    });
  } finally {
    client.release();
  }
});

// ====== UPDATE QC Check ======
router.put("/:id", async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const {
      part_code,
      part_name,
      vendor_name,
      vendor_id,
      vendor_type,
      production_date,
      status,
      remark,
    } = req.body || {};

    console.log(`[PUT QC Check] Updating ID: ${id}`, req.body);

    await client.query("BEGIN");

    // Check if exists
    const checkQuery = `
      SELECT id FROM qc_checks WHERE id = $1 AND is_active = true
    `;
    const checkResult = await client.query(checkQuery, [id]);

    if (checkResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({
        success: false,
        message: "QC Check not found",
      });
    }

    const updateQuery = `
      UPDATE qc_checks
      SET 
        part_code = COALESCE($1, part_code),
        part_name = COALESCE($2, part_name),
        vendor_name = COALESCE($3, vendor_name),
        vendor_id = COALESCE($4, vendor_id),
        vendor_type = COALESCE($5, vendor_type),
        production_date = COALESCE($6::date, production_date),
        status = COALESCE($7, status),
        remark = COALESCE($8, remark),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $9
      RETURNING 
        id,
        part_code,
        part_name,
        vendor_name,
        vendor_id,
        vendor_type,
        TO_CHAR(production_date, 'YYYY-MM-DD') as production_date,
        approved_by,
        approved_by_name,
        approved_at,
        data_from,
        status,
        remark,
        updated_at
    `;

    const values = [
      part_code,
      part_name,
      vendor_name,
      vendor_id,
      vendor_type,
      production_date,
      status,
      remark,
      id,
    ];

    const result = await client.query(updateQuery, values);

    await client.query("COMMIT");

    console.log(`[PUT QC Check] Successfully updated ID: ${id}`);

    res.json({
      success: true,
      message: "QC Check updated successfully",
      data: result.rows[0],
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("[PUT QC Check] Error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update QC check",
      error: error.message,
    });
  } finally {
    client.release();
  }
});

module.exports = router;