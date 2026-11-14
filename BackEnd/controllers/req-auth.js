const CustomAPIError = require('../errors/custom-error')
const { StatusCodes } = require('http-status-codes')
const dbConnect = require('../db/dbconfig')

const modifyAdminAccess = async (req, res) => {
  const { params: { id }, user: { admin } } = req
  if (!admin) {
    throw new CustomAPIError('this user has no access to this route', StatusCodes.UNAUTHORIZED)
  }
  const db = await dbConnect;
  const userResult = await db.query(
    `SELECT "CustomerId", "AdminState" FROM "users" WHERE "CustomerId" = $1`,
    [id]
  );
  
  if (userResult.rows.length === 0) {
    throw new CustomAPIError('User not found', StatusCodes.NOT_FOUND)
  }

  const adminState = userResult.rows[0].AdminState === 0 ? 1 : 0

  // When promoting to admin, also set Admin Tier Access
  // When demoting from admin, reset to Free Access
  const newTier = adminState === 1 ? 'Admin Tier Access' : 'Free Access'

  await db.query(
    `UPDATE "users" SET "AdminState" = $1, "SubscriptionTier" = $2 WHERE "CustomerId" = $3`,
    [adminState, newTier, userResult.rows[0].CustomerId]
  );
  res.status(StatusCodes.OK).send('Admin State Changed Successfully')
}

module.exports = {
  modifyAdminAccess
}