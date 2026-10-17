import { useQuery } from '@tanstack/react-query';

export type ListedBot = {
  id: string;
  name: string;
  strategy: string;
  botName: string;
  host: string;
  online: boolean;
};

export function useListedBots() {
  return useQuery({
    queryKey: ['local-bots'],
    queryFn: async (): Promise<ListedBot[]> => {
      const response = await fetch('/local/bots');
      if (!response.ok) throw new Error('无法读取实盘列表');
      return (await response.json()) as ListedBot[];
    },
    refetchInterval: 15_000,
  });
}
