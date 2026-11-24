import { Router, type IRouter } from "express";
import healthRouter from "./health";
import newsRouter from "./news";
import gameStateRouter from "./game-state";

const router: IRouter = Router();

router.use(healthRouter);
router.use(newsRouter);
router.use(gameStateRouter);

export default router;
