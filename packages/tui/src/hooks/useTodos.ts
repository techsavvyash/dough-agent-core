import { useState, useEffect, useCallback } from "react";
import type { TodoItem } from "@dough/protocol";
import type { DoughClient } from "../client.ts";

export interface VerificationRequest {
  todoId: string;
  title: string;
  instructions: string;
}

export function useTodos(client: DoughClient, sessionId: string | null) {
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [verificationRequest, setVerificationRequest] =
    useState<VerificationRequest | null>(null);

  useEffect(() => {
    const unsubTodos = client.onTodos(setTodos);
    const unsubVerify = client.onTodoVerificationRequest((id, title, instr) => {
      setVerificationRequest({ todoId: id, title, instructions: instr });
    });
    return () => {
      unsubTodos();
      unsubVerify();
    };
  }, [client]);

  const refreshTodos = useCallback(() => {
    if (sessionId) client.listTodos(sessionId);
  }, [client, sessionId]);

  const approveTodo = useCallback(
    (todoId: string, approved: boolean) => {
      client.verifyTodo(todoId, approved);
      setVerificationRequest(null);
    },
    [client]
  );

  return { todos, verificationRequest, refreshTodos, approveTodo };
}
