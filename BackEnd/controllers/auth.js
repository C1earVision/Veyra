const CustomAPIError = require('../errors/custom-error')
const {StatusCodes} = require('http-status-codes')
const dbConnect = require('../db/dbconfig')
const bcrypt = require('bcryptjs')
const jwt = require('jsonwebtoken')

const createJWT = function (admin, _id, name, subscriptionTier){
  return jwt.sign({admin:admin, customerId:_id, name:name, subscriptionTier:subscriptionTier}, process.env.JWT_SECRET, {expiresIn:process.env.JWT_LIFETIME})
}

const comparePassword = async function (sentPass, originalPass){
  const res = await bcrypt.compare(sentPass, originalPass)
  return res
}

const login = async (req,res)=>{
  const {email ,password} = req.body
  const db = await dbConnect;
  const result = await db.query(`
    SELECT 
      "CustomerId",
      "Name",
      "Email",
      "Password",
      "Country",
      "City",
      "Street",
      "State",
      "AdminState",
      "SubscriptionTier"
    FROM 
      "users"
    WHERE 
      "Email" = $1
  `, [email]);

  if(result.rows.length === 0){
    throw new CustomAPIError('Email or password wrong', StatusCodes.UNAUTHORIZED)
  }

  const user = result.rows[0];

  const passIsMatch = await comparePassword(password, user.Password)
  if(!passIsMatch){
    throw new CustomAPIError('Email or password wrong', StatusCodes.UNAUTHORIZED)
  }

  const { Password: _password, ...safeUser } = user
  const token = createJWT(user.AdminState, user.CustomerId, user.Name, user.SubscriptionTier)
  res.status(StatusCodes.OK).json({ user: safeUser, token })
}

module.exports = {
  login
}
