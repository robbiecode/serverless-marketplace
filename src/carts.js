"use strict";

var validate = require("./validate.js");
var db = require("./db.js");
var security = require("./security.js");

//Cart create handler
module.exports.create = async event => {
  try {
    var username = await validate.carts.create(event.body);
  } catch (err) {
    console.log(err);
    return {
      statusCode: 400,
      body: JSON.stringify({
        error: err
      })
    };
  }

  return db.carts
    .create(username)
    .then(security.jwt.generate)
    .then(secret => {
      return {
        statusCode: 200,
        body: JSON.stringify({
          username: username,
          secret: secret
        })
      };
    })
    .catch(err => {
      console.log(err);
      return {
        statusCode: 400,
        body: JSON.stringify({
          error: err
        })
      };
    });
};

//Cart Add Item handler
module.exports.addItem = async event => {
  try {
    var request = await validate.carts.update(
      event.body,
      event.requestContext.authorizer.principalId
    );
  } catch (err) {
    console.log(err);
    return {
      statusCode: 400,
      body: JSON.stringify({
        error: err
      })
    };
  }

  return db.carts
    .get(request.username)
    .then(user => {
      if (!user) {
        return Promise.reject("Invalid user.");
      }

      if (user.cart[request.item]) {
        var quantity = user.cart[request.item].quantity + 1;
        user.cart[request.item] = {
          quantity: quantity
        };
      } else {
        user.cart[request.item] = {
          quantity: 1
        };
      }
      return user;
    })
    .then(db.carts.update)
    .then(updateCart)
    .then(user => {
      const totalCost = calculateTotalCost(user.cart);
      return {
        statusCode: 200,
        body: JSON.stringify({
          username: user.username,
          totalCost: totalCost,
          cart: user.cart
        })
      };
    })
    .catch(err => {
      console.log(err);
      return {
        statusCode: 400,
        body: JSON.stringify({
          error: err
        })
      };
    });
};

//Cart Remove Item handler
module.exports.removeItem = async event => {
  try {
    var request = await validate.carts.update(
      event.body,
      event.requestContext.authorizer.principalId
    );
  } catch (err) {
    console.log(err);
    return {
      statusCode: 400,
      body: JSON.stringify({
        error: err
      })
    };
  }

  return db.carts
    .get(request.username)
    .then(user => {
      if (!user) {
        return Promise.reject("Invalid user.");
      }
      if (user.cart[request.item]) {
        var quantity = user.cart[request.item].quantity - 1;

        if (quantity == 0) {
          delete user.cart[request.item];
        } else {
          user.cart[request.item] = {
            quantity: quantity
          };
        }
      } else {
        return Promise.reject("Product not in cart");
      }
      return user;
    })
    .then(db.carts.update)
    .then(updateCart)
    .then(user => {
      const totalCost = calculateTotalCost(user.cart);
      return {
        statusCode: 200,
        body: JSON.stringify({
          username: user.username,
          totalCost: totalCost,
          cart: user.cart
        })
      };
    })
    .catch(err => {
      console.log(err);
      return {
        statusCode: 400,
        body: JSON.stringify({
          error: err
        })
      };
    });
};

//Cart Complete handler
module.exports.complete = async event => {
  try {
    var request = await validate.carts.complete(
      event.body,
      event.requestContext.authorizer.principalId
    );
  } catch (err) {
    console.log(err);
    return {
      statusCode: 400,
      body: JSON.stringify({
        error: err
      })
    };
  }

  return db.carts
    .get(request.username)
    .then(updateCart)
    .then(user => {
      if (user.cart.length == 0) {
        return Promise.reject("There are currently no items in your cart.");
      }

      for (let product of user.cart) {
        if (product.quantity < product[1].quantity) {
          return Promise.reject(
            `There are currently only ${product.quantity} units of '${
              product[0]
            }' available in stock. In order to complete your cart please remove ${product[1]
              .quantity - product.quantity} unit(s)`
          );
        } else {
          product.quantity -= product[1].quantity;
        }
      }
      return user;
    })
    .then(updateInventory)
    .then(user => {
      user.cart = {};
      return user;
    })
    .then(db.carts.update)
    .then(() => {
      return {
        statusCode: 200,
        body: JSON.stringify({
          message: "Successfully completed cart. 📦"
        })
      };
    })
    .catch(err => {
      console.log(err);
      return {
        statusCode: 400,
        body: JSON.stringify({
          error: err
        })
      };
    });
};

//Cart Get Info handler
module.exports.info = async event => {
  try {
    var request = await validate.carts.info(
      event.body,
      event.requestContext.authorizer.principalId
    );
  } catch (err) {
    console.log(err);
    return {
      statusCode: 400,
      body: JSON.stringify({
        error: err
      })
    };
  }

  return db.carts
    .get(request)
    .then(updateCart)
    .then(user => {
      const totalCost = calculateTotalCost(user.cart);

      return {
        statusCode: 200,
        body: JSON.stringify({
          username: user.username,
          totalCost: totalCost,
          cart: user.cart
        })
      };
    })
    .catch(err => {
      console.log(err);
      return {
        statusCode: 400,
        body: JSON.stringify({
          error: err
        })
      };
    });
};

//Helper function to update product data from database
var getItem = item => {
  return db.products.get(item[0]).then(product => {
    item[1].price = product.price;
    item.quantity = product.quantity;
    return item;
  });
};

//Helper function for updating cart
var updateCart = user => {
  user.cart = Object.entries(user.cart).map(product => getItem(product));
  return Promise.all(user.cart).then(cart => {
    user.cart = cart;
    return user;
  });
};

//Helper function to update inventory data in database
var updateItem = item => {
  var product = {
    title: item[0],
    price: item[1].price,
    quantity: item.quantity
  };

  return db.products.update(product).then(product => {
    return product;
  });
};

//Helper function for updating inventory
var updateInventory = user => {
  user.cart = Object.entries(user.cart).map(product => updateItem(product[1]));
  return Promise.all(user.cart).then(cart => {
    user.cart = cart;
    return user;
  });
};

//Helper function to calculate total cost of each item in cart
var calculateTotalCost = cart => {
  var totalCost = 0;
  cart.forEach(item => {
    totalCost += item[1].price * item[1].quantity;
  });
  return totalCost;
};
