// Every job kind, registered by importing its module. Later kinds (triage.auto, triage.manual,
// assign.ack_timeout, ticket.overdue_sweep) add one import line here.
import "./mail-send";
import "./mail-test";
import "./mail-invite";
import "./mail-account";
import "./triage";
