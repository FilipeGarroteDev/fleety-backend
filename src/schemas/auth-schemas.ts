import joi from 'joi';

const SignUpSchema = joi.object({
  role: joi.string().valid('CLIENT', 'ADMIN').required(),
  password: joi.string().required(),
  name: joi.string().required(),
});

export { SignUpSchema };