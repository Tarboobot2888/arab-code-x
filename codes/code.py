class Silver:
    def __init__(self):
        self.name = "Silver"
        self.path = "Build. Learn. Break. Rebuild."
        self.tools = ["Python", "AI", "OpenCode", "SVPC"]
        self.goal = "Create, not just consume."
        self.limit = None

    def learn(self, problem):
        return f"Study → Understand → Experiment → {problem} → Improve"

    def build(self, idea):
        return {
            "idea": idea,
            "status": "building",
            "owner": self.name,
            "next_step": "make it real"
        }

    def fail(self, error):
        print(f"[ERROR] {error}")
        print("[Silver] Not the end. Find the cause. Fix it. Continue.")

    def run(self):
        while True:
            idea = input(">> ")
            if idea == "exit":
                break
            print(self.build(idea))


silver = Silver()
silver.run()