const {
  modifyAdminAccess
} = require('../controllers/req-auth')

const express = require('express')
const router = express.Router()

router.route('/admin/modifyAccess/:id').patch(modifyAdminAccess)

module.exports = router