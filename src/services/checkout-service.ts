import conflictError from '@/errors/conflictError';
import forbiddenError from '@/errors/forbiddenError';
import notFoundError from '@/errors/notFoundError';
import unauthorizedError from '@/errors/unauthorizedError';
import unprocessableEntityError from '@/errors/unprocessableEntityError';
import { CheckoutBodyEntity, OrderWithProductInfo, PaymentBody } from '@/protocols';
import checkoutRepository from '@/repositories/checkout-repository';
import ordersRepository from '@/repositories/orders-repository';
import ticketsRepository from '@/repositories/tickets-repository';
import waiterRepository from '@/repositories/waiter-repository';
import { Orders, Payments, Tickets } from '@prisma/client';
import { Document, WithId } from 'mongodb';

async function updateFinishedOrders(order: CheckoutBodyEntity): Promise<void> {
  const ticket = await ticketsRepository.getTicketById(order.ticketId);

  if (!ticket) throw notFoundError();

  const orders = await ordersRepository.getAllSelectedOrders(ticket.id);

  if (orders.length === 0) throw unauthorizedError();

  return await checkoutRepository.updateManyOrders(order);
}

async function searchFinishedOrdersByTicketId(ticketId: string): Promise<OrderWithProductInfo[]> {
  const validTicketId = Number(ticketId);

  if (!validTicketId) throw unprocessableEntityError();

  const ticket = await ticketsRepository.getTicketById(validTicketId);

  if (!ticket) throw notFoundError();

  const finishedOrders: OrderWithProductInfo[] = await checkoutRepository.getAllFinishedOrders(validTicketId);
  return finishedOrders;
}

async function payAndUpdateTicket(payment: PaymentBody, ticketId: string, name: string): Promise<[Tickets, Payments]> {
  const validTicketId = Number(ticketId);

  if (!validTicketId) throw unprocessableEntityError();

  const ticket = await ticketsRepository.getTicketById(validTicketId);

  if (!ticket) throw notFoundError();

  const deliveredOrders = await checkoutRepository.getAllDeliveredOrders(ticket.id);

  if (deliveredOrders.length === 0) throw notFoundError();

  const selectedOrPreparingOrders = await checkoutRepository.getAllActiveOrders(ticket.id);

  if (selectedOrPreparingOrders.length > 0) throw conflictError();

  const isValueCorrect: boolean = calculateTotalValue(deliveredOrders, Math.round(payment.totalValue));

  if (!isValueCorrect) throw forbiddenError();

  const newPayment: [Tickets, Payments] = await checkoutRepository.postPaymentAndUpdateTicketStatus(
    payment,
    validTicketId,
  );

  if (payment.isSplitted) {
    await waiterRepository.createNewCall(ticket.userId, name);
  }

  await checkoutRepository.saveFinishedTicket(newPayment[1]);

  return newPayment;
}

function calculateTotalValue(orders: Orders[], totalValue: number) {
  const sum = orders.reduce((acc, curr) => {
    acc += curr.totalValue;
    return acc;
  }, 0);

  if (totalValue >= sum && totalValue <= Math.round(sum * 1.2)) return true;
  return false;
}

async function searchPaidTickets(role: string): Promise<WithId<Document>[]> {
  if (role !== 'ADMIN') throw forbiddenError();

  const finishedTickets: WithId<Document>[] = await checkoutRepository.getFinishedTicketsList();
  return finishedTickets;
}

const checkoutService = {
  updateFinishedOrders,
  searchFinishedOrdersByTicketId,
  payAndUpdateTicket,
  searchPaidTickets,
};

export default checkoutService;
